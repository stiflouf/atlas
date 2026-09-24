import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// WORKSPACE_SCOPING_V1 (ADR-054) — deux gardes, et seulement deux, parce qu'elles répondent aux
// deux façons dont une frontière de workspace se perd silencieusement :
//
//   1. une NOUVELLE route d'API sert des données métier sans jamais résoudre le périmètre ;
//   2. un lecteur NON SCOPÉ est réutilisé depuis un écran ou une action, avec un identifiant qui
//      vient du client.
//
// Ces gardes ne prouvent rien par elles-mêmes : la preuve, ce sont les tests d'intégration et de
// Route Handler qui exercent réellement deux workspaces. Elles empêchent la régression.

const SRC = join(__dirname, "..");
const lire = (chemin: string) => readFileSync(chemin, "utf8");
const codeSeul = (chemin: string) =>
  lire(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

function listerFichiers(racine: string, filtre: (chemin: string) => boolean): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...listerFichiers(chemin, filtre));
    else if (filtre(chemin)) trouves.push(chemin);
  }
  return trouves;
}

// ───────────────────────────── 1. CLASSIFICATION DES ROUTES ─────────────────────────────

// Toute route sous src/app/api DOIT figurer ici, dans exactement une catégorie. Une route non
// classée fait échouer ce test : c'est le seul moment où quelqu'un est forcé de se demander « qui
// a le droit de lire ça ? ».
const ROUTES_DONNEES_UTILISATEUR = [
  "api/documents/[id]/route.ts",
  "api/photos-bien/[photoId]/route.ts",
  "api/bons-visite/[id]/document/route.ts",
  "api/biens/[id]/pack-notaire/route.ts",
];

// Déclenchées par un cron externe avec un secret partagé : délibérément TRANS-workspace (elles
// balayent tout le parc). Leur garde est le Bearer, pas le périmètre.
const ROUTES_MACHINE = [
  "api/automatisations/scan/route.ts",
  "api/automatisations/reprise/route.ts",
  "api/compatibilite/scan/route.ts",
  "api/compatibilite/baseline/route.ts",
];

// Identité : elles créent ou détruisent la session, elles ne peuvent pas dépendre d'un périmètre
// qui n'existe pas encore (ADR-054 §3 — IDENTITY et OWNERSHIP ne partagent jamais une colonne).
const ROUTES_AUTH = [
  "api/auth/atlas/login/route.ts",
  "api/auth/atlas/callback/route.ts",
  "api/auth/atlas/logout/route.ts",
  "api/auth/google/login/route.ts",
  "api/auth/google/gmail/login/route.ts",
  "api/auth/google/callback/route.ts",
  "api/auth/google/logout/route.ts",
];

// Ne touche aucune donnée du produit : relais vers une API publique.
const ROUTES_PROXY = ["api/geocodage/communes/route.ts"];

// Lecteurs qui portent eux-mêmes la preuve d'appartenance (filtre `workspace_id` direct ou
// jointure vers une racine). Une route de données utilisateur est conforme si elle résout le
// workspace ET n'appelle que des lecteurs de cette liste.
const LECTEURS_SCOPES = [
  "getDocumentBienDuWorkspace",
  "getPhotoBienDuWorkspace",
  "getDocumentBonVisitePourTelechargement",
  "chargerContextePackNotaire",
];

describe("Frontière workspace — classification des Route Handlers", () => {
  const routes = listerFichiers(join(SRC, "app", "api"), (c) => c.endsWith(`${sep}route.ts`)).map((c) =>
    relative(join(SRC, "app"), c).split(sep).join("/")
  );

  it("chaque route d'API est classée exactement une fois (une route non classée échoue ici)", () => {
    const classees = [...ROUTES_DONNEES_UTILISATEUR, ...ROUTES_MACHINE, ...ROUTES_AUTH, ...ROUTES_PROXY];
    expect([...routes].sort()).toEqual([...classees].sort());
    expect(new Set(classees).size).toBe(classees.length);
  });

  it("chaque route de DONNÉES UTILISATEUR résout le workspace et ne lit que par un lecteur scopé", () => {
    for (const route of ROUTES_DONNEES_UTILISATEUR) {
      // Commentaires retirés : plusieurs routes CITENT le lecteur non scopé pour expliquer
      // pourquoi elles ne l'utilisent pas — c'est de la documentation, pas un appel.
      const source = codeSeul(join(SRC, "app", ...route.split("/")));
      expect(source, route).toContain("exigerWorkspaceCourant");
      // Elle doit appeler au moins un lecteur scopé…
      expect(LECTEURS_SCOPES.some((lecteur) => source.includes(lecteur)), `${route} : aucun lecteur scopé`).toBe(true);
      // …et aucun lecteur non scopé du domaine servi.
      for (const interdit of ["getDocumentBienById", "getPhotoBien(", "getBienById", "getClientById"]) {
        expect(source.includes(interdit), `${route} → ${interdit}`).toBe(false);
      }
    }
  });

  it("les routes machine restent protégées par un secret Bearer, jamais par une session", () => {
    for (const route of ROUTES_MACHINE) {
      const source = codeSeul(join(SRC, "app", ...route.split("/")));
      expect(source.toLowerCase(), route).toContain("authorization");
      expect(source, route).not.toContain("exigerWorkspaceCourant");
    }
  });
});

// ───────────────────────────── 2. LECTEURS NON SCOPÉS ─────────────────────────────

// Lecteurs qui résolvent une entité par identifiant SANS preuve d'appartenance. Ils restent
// légitimes en interne (moteurs, chaînes déjà validées en amont), mais un écran ou une Server
// Action qui les appelle avec un id venu du client rouvre exactement la faille que ce lot ferme.
//
// Chaque exception ci-dessous est nommée et justifiée. Une exception sans justification est un
// oubli, pas une décision.
const LECTEURS_NON_SCOPES = [
  "getBienById",
  "getClientById",
  "getProspectVendeurById",
  "getTacheById",
  "getDocumentBienById",
  "getPhotoBien",
  "getContactById",
];

const EXCEPTIONS_JUSTIFIEES: Record<string, string[]> = {
  // ── Chaînes déjà validées en amont : l'identifiant ne vient PAS du formulaire, il est dérivé
  // d'une entité elle-même résolue dans le périmètre. Le durcir une seconde fois n'ajouterait
  // aucune garantie.
  // `compromisId` est validé par `getCompromisById(..., workspaceId)` avant ces lectures.
  "actions/remuneration.ts": ["getBienById", "getClientById"],
  "actions/transmissionDossierNotaire.ts": ["getBienById"],
  // `visiteId` est validé par `getVisiteById(..., workspaceId)` ; bien et acquéreur en dérivent.
  "actions/creerTacheProchaineEtape.ts": ["getBienById", "getClientById"],
  // L'identifiant vient du contexte Google Calendar du conseiller connecté, jamais d'un champ.
  "actions/visite.ts": ["getBienById", "getClientById"],

  // ── V2, dette connue et documentée : jalons du parcours prospect vendeur, repères relationnels
  // et secteurs de recherche de l'acquéreur.
  "actions/prospectVendeur.ts": ["getProspectVendeurById"],
  "actions/repereRelationnel.ts": ["getClientById"],
  "actions/secteurRecherche.ts": ["getClientById"],

  // ── V2, écrans de lecture seule : ce lot durcit les MUTATIONS et les routes qui servent des
  // fichiers. Une page hors périmètre affiche aujourd'hui une fiche qu'elle ne devrait pas
  // montrer ; elle ne permet plus, depuis ce lot, de la modifier.
  "app/biens/[id]/page.tsx": ["getBienById", "getClientById"],
  "app/biens/[id]/modifier/page.tsx": ["getBienById"],
  "app/biens/[id]/photos/page.tsx": ["getBienById"],
  "app/clients/[id]/page.tsx": ["getClientById", "getBienById"],
  "app/clients/[id]/modifier/page.tsx": ["getClientById"],
  "app/compromis/nouveau/page.tsx": ["getBienById", "getClientById"],
  "app/offres/nouveau/page.tsx": ["getBienById", "getClientById"],
  "app/prospects-vendeurs/[id]/page.tsx": ["getProspectVendeurById", "getBienById"],
  "app/prospects-vendeurs/[id]/modifier/page.tsx": ["getProspectVendeurById"],
  "app/prospects-vendeurs/[id]/signer-mandat/page.tsx": ["getProspectVendeurById"],
  "app/visites/[id]/page.tsx": ["getBienById", "getClientById"],
  "app/visites/[id]/preparer/page.tsx": ["getBienById", "getClientById"],
  "app/visites/[id]/bon-de-visite/[bonId]/page.tsx": ["getClientById"],
};

describe("Frontière workspace — lecteurs non scopés hors des écrans et des actions", () => {
  const surfaces = [
    ...listerFichiers(join(SRC, "app"), (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c)),
    ...listerFichiers(join(SRC, "actions"), (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)),
  ];

  it("aucun écran ni aucune action n'importe un lecteur non scopé, hors exceptions nommées", () => {
    const fautifs: string[] = [];
    for (const chemin of surfaces) {
      const relatif = relative(SRC, chemin).split(sep).join("/");
      const source = lire(chemin)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      for (const lecteur of LECTEURS_NON_SCOPES) {
        const motif = new RegExp(`\\b${lecteur}\\b`);
        if (!motif.test(source)) continue;
        if (EXCEPTIONS_JUSTIFIEES[relatif]?.includes(lecteur)) continue;
        fautifs.push(`${relatif} → ${lecteur}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("chaque exception nommée existe encore : une exception périmée doit être retirée, pas oubliée", () => {
    for (const relatif of Object.keys(EXCEPTIONS_JUSTIFIEES)) {
      const chemin = join(SRC, ...relatif.split("/"));
      expect(() => lire(chemin), relatif).not.toThrow();
    }
  });

  it("les surfaces durcies par ce lot n'ont plus aucune exception", () => {
    for (const durci of [
      "actions/gererPhotosBien.ts",
      "actions/ajouterPhotoBien.ts",
      "actions/ajouterDocumentBien.ts",
      "actions/archivageBien.ts",
      "actions/archivageAcquereur.ts",
      "actions/statutCommercialBien.ts",
      "actions/terminerTache.ts",
      "actions/annulerTache.ts",
      "actions/creerTache.ts",
      "actions/modifierBien.ts",
      "actions/ajouterNoteBien.ts",
      "actions/enregistrerCompteRenduVisite.ts",
    ]) {
      expect(EXCEPTIONS_JUSTIFIEES[durci], durci).toBeUndefined();
      const source = lire(join(SRC, ...durci.split("/")));
      expect(source, durci).toContain("exigerWorkspaceCourant");
    }
  });
});
