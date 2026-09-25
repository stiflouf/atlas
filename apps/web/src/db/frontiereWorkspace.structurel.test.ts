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

  // (WORKSPACE_SCOPING_V2A a refermé actions/prospectVendeur.ts, actions/repereRelationnel.ts et
  // actions/secteurRecherche.ts : leurs exceptions ont été retirées, pas commentées.)

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

// ───────────────────────────── 3. WRITERS DES DOMAINES USER-FACING ─────────────────────────────

// WORKSPACE_SCOPING_V2A — les deux gardes ci-dessus raisonnent sur les IMPORTS. Elles n'ont donc
// rien vu des six actions qui écrivaient sans jamais lire (archiver un repère, supprimer un
// secteur, archiver un prospect…) : sans reader importé, aucune trace à détecter.
//
// Celle-ci raisonne sur les ÉCRITURES. Règle : dans ces repositories, toute fonction exportée qui
// écrit doit recevoir un `workspaceId`. Peu importe qu'elle le porte dans son `WHERE` (table
// racine) ou qu'elle le prouve sous verrou sur sa racine (table feuille) — ce qui est verrouillé
// ici, c'est qu'une écriture ne puisse pas être ajoutée sans que la question du périmètre soit
// posée. C'est la garde qui aurait arrêté les 15 mutations restées ouvertes après V1.
const REPOSITORIES_USER_FACING = [
  "lib/bienRepository.ts",
  "lib/clientRepository.ts",
  "lib/prospectVendeurRepository.ts",
  "lib/noteProspectVendeurRepository.ts",
  "lib/repereRelationnelRepository.ts",
  "lib/secteurRechercheRepository.ts",
  "lib/tacheRepository.ts",
  "lib/photoBienRepository.ts",
  "lib/documentBienRepository.ts",
];

// Écritures dont le périmètre est porté autrement. Chaque entrée dit pourquoi — une exception sans
// justification est un oubli, pas une décision.
const WRITERS_SANS_WORKSPACE_JUSTIFIES: Record<string, string> = {
  // (WORKSPACE_SCOPING_V2B5 a refermé `cloturerTachesAutomatiquesObsoletes` et `cloturerTachesParIds` :
  // leurs exceptions ont été RETIRÉES, pas commentées. Elles disaient « trans-workspace par
  // conception » ; c'était vrai d'un scan qui ne connaissait qu'un workspace, et c'était devenu la
  // fuite la plus sévère du moteur dès qu'il y en avait deux — le scan de A annulait les tâches
  // automatiques de B. Les deux reçoivent désormais un `workspaceId` obligatoire, posé en SQL.)

  // Feuilles de `biens` : ces deux writers ne sont jamais atteints qu'après que l'appelant a prouvé
  // le bien dans son périmètre (V1 — ajouterDocumentBienAction / corrigerClassementDocumentBienAction
  // passent par getBienDuWorkspace et getDocumentBienDuWorkspace), ou depuis le domaine Bon de
  // visite dont la chaîne visite → bien → workspace est déjà scopée.
  enregistrerDocumentBien: "feuille de `biens`, bien prouvé par l'appelant (V1)",
  corrigerClassementDocumentBien: "feuille de `biens`, document ET bien cible prouvés par l'appelant (V1)",
};

describe("Frontière workspace — writers des domaines user-facing", () => {
  it("toute fonction exportée qui écrit reçoit un workspaceId, ou figure dans les exceptions justifiées", () => {
    const fautifs: string[] = [];
    for (const relatif of REPOSITORIES_USER_FACING) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      // Découpe grossière mais suffisante : chaque `export async function` jusqu'au suivant.
      const blocs = source.split(/(?=export async function )/);
      for (const bloc of blocs) {
        const nom = /^export async function (\w+)/.exec(bloc)?.[1];
        if (!nom) continue;
        // La signature s'arrête à la parenthèse fermante de la liste de paramètres — pas au premier
        // `{`, qui appartient souvent à un paramètre objet (`input: { … }`).
        let profondeur = 0;
        let finSignature = bloc.length;
        for (let i = bloc.indexOf("("); i < bloc.length; i += 1) {
          if (bloc[i] === "(") profondeur += 1;
          else if (bloc[i] === ")") {
            profondeur -= 1;
            if (profondeur === 0) {
              finSignature = i;
              break;
            }
          }
        }
        const signature = bloc.slice(0, finSignature);
        const corps = bloc.slice(finSignature);
        const ecrit = /\.(insert|update|delete)\(/.test(corps);
        if (!ecrit) continue;
        if (/workspaceId/.test(signature)) continue;
        if (WRITERS_SANS_WORKSPACE_JUSTIFIES[nom]) continue;
        fautifs.push(`${relatif} → ${nom}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("chaque exception nommée correspond encore à une fonction qui existe", () => {
    const toutes = REPOSITORIES_USER_FACING.map((r) => codeSeul(join(SRC, ...r.split("/")))).join("\n");
    for (const nom of Object.keys(WRITERS_SANS_WORKSPACE_JUSTIFIES)) {
      expect(toutes, nom).toContain(`export async function ${nom}`);
    }
  });
});

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

  // Une exception qui ne correspond plus à rien est pire qu'absente : elle fait croire à une dette
  // qui n'existe plus, et masque le fait que la surface est déjà fermée. Le test échoue donc AUSSI
  // quand le fichier a cessé d'importer le lecteur qu'on l'autorisait à importer.
  it("chaque exception nommée correspond encore à un import réel : une exception périmée doit être retirée", () => {
    const perimees: string[] = [];
    for (const [relatif, lecteurs] of Object.entries(EXCEPTIONS_JUSTIFIEES)) {
      const chemin = join(SRC, ...relatif.split("/"));
      expect(() => lire(chemin), relatif).not.toThrow();
      const source = codeSeul(chemin);
      for (const lecteur of lecteurs) {
        if (!new RegExp(`\\b${lecteur}\\b`).test(source)) perimees.push(`${relatif} → ${lecteur}`);
      }
    }
    expect(perimees).toEqual([]);
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

// ───────────────────────── 4. LECTEURS DE LISTE GLOBAUX ─────────────────────────

// WORKSPACE_SCOPING_V2B4 — les trois gardes précédentes surveillent les lecteurs UNITAIRES par id
// et les écritures. Aucune ne voyait les lecteurs de LISTE, qui sont pourtant la fuite la plus
// large : un `SELECT` sans `WHERE` ne révèle pas une entité, il révèle un catalogue. Les lots
// V2B1 à V2B3 les ont refermés un par un ; ce bloc empêche qu'un nouveau chemin les rouvre.
//
// Deux principes, tirés de ce que les audits ont montré :
//
//   1. Un catalogue NOMMÉ, jamais une regex sur `lister.*` — le dépôt compte une quarantaine de
//      lecteurs déjà scopés par leur parent (`listerNotesPourBien`, `listerOffresPourBien`…) qui
//      produiraient un bruit tel que la garde finirait désactivée.
//   2. Le périmètre protégé dépasse `app/**` et `actions/**`. Plusieurs fuites vivaient dans des
//      MODULES-RELAIS : des helpers de `lib/` qui chargent les données d'un écran. Les scanner
//      tous serait faux (les moteurs machine sont légitimement globaux), d'où une liste explicite.

// Lecteurs qui lisent une table entière, sans périmètre. Les noms viennent du code réel.
const LECTEURS_LISTE_GLOBAUX = [
  "listerBiens",
  "listerClients",
  "listerTaches",
  "listerVisites",
  "listerComptesRendus",
  "listerProspectsVendeursPourMachine",
  "listerProspectsVendeursPerdus",
  "listerProspectsVendeursConvertis",
  "listerProspectsVendeursArchives",
  "listerBiensActifsPersistes",
  "listerClientsActifsPersistes",
  // WORKSPACE_SCOPING_V2B5 — ne rend pas des données métier, mais la LISTE DES PÉRIMÈTRES. Un écran
  // qui l'appelle est en train de se construire une boucle « pour chaque workspace », c'est-à-dire
  // exactement la fuite que les lots V2B ont refermée, une itération plus loin.
  "listerTousLesWorkspaceIds",
];

// Alternative scopée à proposer dans le message d'erreur. Une garde qui dit seulement « interdit »
// fait perdre du temps ; celle-ci dit quoi écrire à la place.
const ALTERNATIVE_SCOPEE: Record<string, string> = {
  listerBiens: "listerBiensActifsDuWorkspace(workspaceId)",
  listerClients: "listerAcquereursActifsDuWorkspace(workspaceId)",
  listerTaches: "listerTachesDuWorkspace(workspaceId)",
  listerVisites: "listerVisitesDuWorkspace(workspaceId)",
  listerComptesRendus: "listerComptesRendusDuWorkspace(workspaceId)",
  listerProspectsVendeursPourMachine: 'listerProspectsVendeursDuWorkspace(workspaceId, "en_cours")',
  listerProspectsVendeursPerdus: 'listerProspectsVendeursDuWorkspace(workspaceId, "perdus")',
  listerProspectsVendeursConvertis: 'listerProspectsVendeursDuWorkspace(workspaceId, "convertis")',
  listerProspectsVendeursArchives: 'listerProspectsVendeursDuWorkspace(workspaceId, "archives")',
  listerTousLesWorkspaceIds: "exigerWorkspaceCourant() — un écran n'a qu'un périmètre, celui de sa session",
  listerBiensActifsPersistes: "réservé au synchroniseur de compatibilité (ADR-036)",
  listerClientsActifsPersistes: "réservé au synchroniseur de compatibilité (ADR-036)",
};

// MODULES-RELAIS : des helpers de `lib/` qui assemblent les données d'un écran. Ils ne sont ni
// dans `app/**` ni dans `actions/**`, et c'est précisément pourquoi les fuites y ont survécu le
// plus longtemps. Une nouvelle entrée ici chaque fois qu'un module charge pour un écran.
const MODULES_CONTEXTE_ECRAN = [
  "lib/alertes/contexte.ts",
  "lib/opportunites/contexte.ts",
  "lib/communications/contexteEcranCommunication.ts",
  "lib/compatibilite/orchestration.ts",
  "lib/dashboardRepository.ts",
  "lib/rendezVousContexte.ts",
];

// ALLOWLIST MACHINE, par FICHIER et non par nom : un lecteur global n'est jamais « sûr » en soi,
// il l'est à un endroit précis. `listerProspectsVendeursPourMachine` porte « machine » dans son
// nom et reste interdit partout ailleurs que dans son scanner.
const LECTEURS_MACHINE_AUTORISES_PAR_FICHIER: Record<string, { lecteurs: string[]; raison: string }> = {
  // (WORKSPACE_SCOPING_V2B5 a retiré l'entrée du scanner d'inactivité : il lit désormais
  // `listerProspectsVendeursDuWorkspace(workspaceId, "en_cours")`, au contrat métier strictement
  // identique, et le scan temporel est devenu une passe PAR workspace. Plus aucun lecteur global
  // n'est autorisé dans `lib/automatisations/**`.)
  "lib/compatibilite/synchronisation.ts": {
    lecteurs: ["listerBiensActifsPersistes", "listerClientsActifsPersistes"],
    raison: "synchroniseur de compatibilité (ADR-036) : croise le parc entier, jamais appelé depuis une session",
  },
  "lib/compatibilite/baseline.ts": {
    lecteurs: ["listerBiensActifsPersistes", "listerClientsActifsPersistes"],
    raison: "calcul de baseline de compatibilité (ADR-036), route machine à Bearer",
  },
};

// Dette V2C/V2D, nommée surface par surface. Ces pages lisent encore un catalogue global ; elles
// seront traitées avec les autres surfaces par id (V2C) et la frontière Calendar (V2D).
const EXCEPTIONS_LISTE_JUSTIFIEES: Record<string, string[]> = {
  // V2C — surfaces par id : le panneau de matching et les formulaires de création lisent encore
  // le catalogue complet pour alimenter un `<select>` ou une liste de compatibilité.
  "app/biens/[id]/page.tsx": ["listerClients"],
  "app/clients/[id]/page.tsx": ["listerBiens", "listerTaches", "listerComptesRendus"],
  "app/compromis/nouveau/page.tsx": ["listerClients"],
  "app/offres/nouveau/page.tsx": ["listerClients"],
  // V2D — le matching des rendez-vous Google travaille sur le référentiel complet, et la
  // connexion Calendar est elle-même un singleton sans notion de workspace.
  "lib/rendezVousContexte.ts": ["listerBiens", "listerClients"],
};

// Détecte un appel ou un import du lecteur, jamais une simple mention en commentaire (les
// commentaires sont retirés en amont par `codeSeul`).
function lecteursUtilises(source: string): string[] {
  return LECTEURS_LISTE_GLOBAUX.filter((lecteur) => new RegExp(`\\b${lecteur}\\b`).test(source));
}

function verifierSurface(relatif: string, source: string): string[] {
  const autorisesMachine = LECTEURS_MACHINE_AUTORISES_PAR_FICHIER[relatif]?.lecteurs ?? [];
  const exceptions = EXCEPTIONS_LISTE_JUSTIFIEES[relatif] ?? [];
  return lecteursUtilises(source)
    .filter((lecteur) => !autorisesMachine.includes(lecteur) && !exceptions.includes(lecteur))
    .map(
      (lecteur) =>
        `${relatif} utilise ${lecteur}, lecteur global interdit dans une surface utilisateur — utiliser ${
          ALTERNATIVE_SCOPEE[lecteur] ?? "un lecteur scopé workspace"
        }`
    );
}

describe("Frontière workspace — lecteurs de liste globaux", () => {
  const surfacesUtilisateur = [
    ...listerFichiers(join(SRC, "app"), (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c)),
    ...listerFichiers(join(SRC, "actions"), (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)),
    ...listerFichiers(join(SRC, "components"), (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c)),
  ].map((chemin) => relative(SRC, chemin).split(sep).join("/"));

  it("aucun écran, action ou composant n'utilise un lecteur de liste global, hors exceptions nommées", () => {
    const fautifs = surfacesUtilisateur.flatMap((relatif) =>
      verifierSurface(relatif, codeSeul(join(SRC, ...relatif.split("/"))))
    );
    expect(fautifs).toEqual([]);
  });

  it("les modules-relais de contexte d'écran sont soumis à la même règle", () => {
    const fautifs = MODULES_CONTEXTE_ECRAN.flatMap((relatif) =>
      verifierSurface(relatif, codeSeul(join(SRC, ...relatif.split("/"))))
    );
    expect(fautifs).toEqual([]);
  });

  // Prouver la CAPACITÉ DE DÉTECTION, pas seulement que le dépôt est propre aujourd'hui : un test
  // qui ne fait que constater l'état actuel passerait encore si la garde était vide.
  it("détecte un lecteur global introduit dans une page utilisateur", () => {
    const faux = `import { listerBiens } from "@/lib/bienRepository";
      export default async function Page() { const biens = await listerBiens(); return biens.length; }`;
    const fautifs = verifierSurface("app/faux-ecran/page.tsx", faux);
    expect(fautifs).toHaveLength(1);
    expect(fautifs[0]).toContain("listerBiens");
    expect(fautifs[0]).toContain("listerBiensActifsDuWorkspace(workspaceId)");
  });

  it("détecte un lecteur MACHINE utilisé depuis une surface utilisateur, malgré son nom", () => {
    const faux = `import { listerProspectsVendeursPourMachine } from "@/lib/prospectVendeurRepository";
      export default async function Page() { return (await listerProspectsVendeursPourMachine()).length; }`;
    const fautifs = verifierSurface("app/faux-ecran/page.tsx", faux);
    expect(fautifs).toHaveLength(1);
    expect(fautifs[0]).toContain("listerProspectsVendeursPourMachine");
  });

  it("laisse passer un lecteur machine dans le fichier machine qui l'autorise", () => {
    const relatif = "lib/compatibilite/synchronisation.ts";
    const faux = `const b = await listerBiensActifsPersistes();`;
    expect(verifierSurface(relatif, faux)).toEqual([]);
    // …et le même fichier ne reçoit pas pour autant un blanc-seing sur les autres lecteurs.
    expect(verifierSurface(relatif, `const t = await listerTaches();`)).toHaveLength(1);
  });

  // WORKSPACE_SCOPING_V2B5 — le scanner d'inactivité CITE encore le lecteur global en commentaire
  // pour expliquer ce qu'il a cessé d'utiliser. C'est de la documentation, pas un appel : la garde
  // doit le laisser passer, et elle n'a plus aucune entrée d'allowlist pour ce fichier.
  it("ne se déclenche pas sur une simple mention en commentaire", () => {
    const relatif = "lib/automatisations/scanners/inactiviteProspectVendeur.ts";
    const chemin = join(SRC, ...relatif.split("/"));
    expect(lire(chemin)).toContain("listerProspectsVendeursPourMachine");
    expect(codeSeul(chemin)).not.toContain("listerProspectsVendeursPourMachine");
    expect(LECTEURS_MACHINE_AUTORISES_PAR_FICHIER[relatif]).toBeUndefined();
    expect(verifierSurface(relatif, codeSeul(chemin))).toEqual([]);
  });

  it("chaque allowlist machine correspond à un usage réel : une entrée morte doit être retirée", () => {
    const mortes: string[] = [];
    for (const [relatif, { lecteurs }] of Object.entries(LECTEURS_MACHINE_AUTORISES_PAR_FICHIER)) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      for (const lecteur of lecteurs) {
        if (!new RegExp(`\\b${lecteur}\\b`).test(source)) mortes.push(`${relatif} → ${lecteur}`);
      }
    }
    expect(mortes).toEqual([]);
  });

  it("chaque exception V2C/V2D correspond à un usage réel : une exception périmée doit être retirée", () => {
    const perimees: string[] = [];
    for (const [relatif, lecteurs] of Object.entries(EXCEPTIONS_LISTE_JUSTIFIEES)) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      for (const lecteur of lecteurs) {
        if (!new RegExp(`\\b${lecteur}\\b`).test(source)) perimees.push(`${relatif} → ${lecteur}`);
      }
    }
    expect(perimees).toEqual([]);
  });

  it("les lecteurs scopés qui remplacent les globaux exigent tous un workspaceId", () => {
    // Le nom ne prouve rien : on vérifie la signature réelle. `workspaceId?` serait un compromis
    // qui viderait la garde de son sens.
    const aVerifier: [string, string][] = [
      ["lib/bienRepository.ts", "listerBiensActifsDuWorkspace"],
      ["lib/clientRepository.ts", "listerAcquereursActifsDuWorkspace"],
      ["lib/tacheRepository.ts", "listerTachesDuWorkspace"],
      ["lib/visiteRepository.ts", "listerVisitesDuWorkspace"],
      ["lib/compteRenduVisiteRepository.ts", "listerComptesRendusDuWorkspace"],
      ["lib/prospectVendeurRepository.ts", "listerProspectsVendeursDuWorkspace"],
    ];
    for (const [relatif, nom] of aVerifier) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      const signature = new RegExp(`export async function ${nom}\\(([^)]*)\\)`).exec(source)?.[1] ?? "";
      expect(signature, `${relatif} → ${nom}`).toContain("workspaceId: string");
      expect(signature, `${relatif} → ${nom} : workspaceId ne doit jamais être optionnel`).not.toContain(
        "workspaceId?"
      );
    }
  });
});

// ───────────────── 5. MOTEUR D'AUTOMATISATION MULTI-WORKSPACE ─────────────────

// WORKSPACE_SCOPING_V2B5 — les quatre gardes précédentes raisonnent sur des lectures et des
// écritures d'entités métier. Aucune ne voyait le moteur d'automatisation, qui a sa propre façon de
// perdre une frontière, en quatre points que ce lot vient de refermer :
//
//   1. un `ON CONFLICT` dont la cible n'inclut pas le workspace — l'upsert d'un workspace écrase
//      alors la ligne d'un autre (corruption silencieuse, jamais une simple fuite de lecture) ;
//   2. un scanner qui résout « le » workspace au lieu de recevoir celui qu'il traite ;
//   3. un chemin MACHINE qui se met à dépendre d'une session ;
//   4. un lecteur de configuration qui accepte de travailler sans périmètre.
//
// Chaque garde prouve aussi sa CAPACITÉ DE DÉTECTION sur une source fabriquée : une garde qui ne
// ferait que constater l'état actuel du dépôt passerait encore si elle était vide.

const FICHIERS_MOTEUR_AUTOMATISATION = listerFichiers(
  join(SRC, "lib", "automatisations"),
  (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)
).map((chemin) => relative(SRC, chemin).split(sep).join("/"));

const CONFIG_REPOSITORY = "lib/automatisations/configurationAutomatisationRepository.ts";

// `onConflictDoUpdate({ target: ... })` sur `configurationsAutomatisation` : la cible doit être le
// COUPLE. Détecté sur le texte de l'option `target`, car c'est exactement ce qui s'écrit à la main.
function ciblesOnConflictConfiguration(source: string): string[] {
  return [...source.matchAll(/onConflictDoUpdate\(\{\s*(?:\/\/[^\n]*\n\s*)*target:\s*([^\n]*)/g)].map((m) => m[1]);
}

describe("Frontière workspace — configuration d'automatisation par workspace", () => {
  it("tout ON CONFLICT sur les configurations cible (workspaceId, regleCode), jamais regleCode seul", () => {
    const fautifs: string[] = [];
    for (const relatif of FICHIERS_MOTEUR_AUTOMATISATION) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      if (!/configurationsAutomatisation/.test(source)) continue;
      for (const cible of ciblesOnConflictConfiguration(source)) {
        const porteLeWorkspace = /configurationsAutomatisation\.workspaceId/.test(cible);
        const porteLaRegle = /configurationsAutomatisation\.regleCode/.test(cible);
        if (!porteLeWorkspace || !porteLaRegle) {
          fautifs.push(
            `${relatif} : ON CONFLICT ciblant ${cible.trim()} — la clé d'une configuration est le couple ` +
              `[configurationsAutomatisation.workspaceId, configurationsAutomatisation.regleCode] (PK depuis la migration 0054). ` +
              `Cibler regle_code seul fait écraser la configuration d'un autre workspace.`
          );
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  // La garde ci-dessus ne voit que le Drizzle de `lib/automatisations/**`. Le SQL BRUT écrit
  // ailleurs (le seed de démonstration, par exemple) écrit dans la même table sans passer par ce
  // repository : c'est exactement par là que la migration 0054 a cassé un `on conflict (regle_code)`
  // resté en texte, invisible pour le typecheck comme pour la garde Drizzle.
  it("tout ON CONFLICT en SQL brut sur cette table cible aussi le couple", () => {
    // Les fichiers de TEST sont exclus : ils citent volontiers du SQL en clair (celui de ce
    // message d'erreur, par exemple). La garde protège les chemins de production — src/ et le seed.
    const estTest = (c: string) => /\.test\.[cm]?[jt]sx?$/.test(c);
    const fichiers = [
      ...listerFichiers(join(SRC, "..", "scripts"), (c) => /\.(mjs|js|ts)$/.test(c) && !estTest(c)),
      ...listerFichiers(SRC, (c) => /\.tsx?$/.test(c) && !estTest(c)),
    ];
    const fautifs: string[] = [];
    for (const chemin of fichiers) {
      const source = codeSeul(chemin);
      if (!/configurations_automatisation/.test(source)) continue;
      for (const m of source.matchAll(/on conflict\s*\(([^)]*)\)/gi)) {
        // Seuls les ON CONFLICT qui visent CETTE table nous concernent : on exige que l'instruction
        // qui les porte la nomme, en remontant jusqu'au `insert into` qui précède.
        const avant = source.slice(0, m.index ?? 0);
        const insertion = avant.lastIndexOf("insert into");
        if (insertion === -1) continue;
        if (!/configurations_automatisation/.test(avant.slice(insertion))) continue;
        const colonnes = m[1];
        if (!/workspace_id/.test(colonnes) || !/regle_code/.test(colonnes)) {
          fautifs.push(
            `${relative(SRC, chemin).split(sep).join("/")} : on conflict (${colonnes.trim()}) — depuis la ` +
              `migration 0054 la clé primaire est (workspace_id, regle_code) ; cibler regle_code seul lève ` +
              `« there is no unique or exclusion constraint matching the ON CONFLICT specification ».`
          );
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("détecte un ON CONFLICT revenu à regleCode seul", () => {
    const faux = `await getDb().insert(configurationsAutomatisation).values({ regleCode, active, workspaceId })
      .onConflictDoUpdate({ target: configurationsAutomatisation.regleCode, set: { active } });`;
    const cibles = ciblesOnConflictConfiguration(faux);
    expect(cibles).toHaveLength(1);
    expect(/configurationsAutomatisation\.workspaceId/.test(cibles[0])).toBe(false);
  });

  it("les deux writers de configuration existent et ciblent bien le couple", () => {
    const source = codeSeul(join(SRC, ...CONFIG_REPOSITORY.split("/")));
    for (const writer of ["definirActivationAutomatisation", "definirSeuilAutomatisation"]) {
      expect(source, writer).toContain(`export async function ${writer}`);
    }
    const cibles = ciblesOnConflictConfiguration(source);
    expect(cibles).toHaveLength(2);
    for (const cible of cibles) {
      expect(cible).toContain("configurationsAutomatisation.workspaceId");
      expect(cible).toContain("configurationsAutomatisation.regleCode");
    }
  });

  // Le nom d'une fonction ne prouve rien : on lit la signature réelle. `workspaceId?` serait un
  // compromis qui viderait la garde de son sens — un appelant qui l'oublie retomberait sur une
  // lecture globale sans qu'aucun type ne proteste.
  it("toute fonction exportée du repository de configuration exige un workspaceId non optionnel", () => {
    const source = codeSeul(join(SRC, ...CONFIG_REPOSITORY.split("/")));
    const fautifs: string[] = [];
    for (const bloc of source.split(/(?=export async function )/)) {
      const nom = /^export async function (\w+)/.exec(bloc)?.[1];
      if (!nom) continue;
      // Seules les fonctions qui parlent réellement à Postgres sont concernées : un helper pur
      // (conversion de ligne, constante) n'a aucun périmètre à recevoir.
      if (!/getDb\(\)/.test(bloc)) continue;
      const signature = bloc.slice(0, bloc.indexOf("): Promise"));
      if (!/workspaceId: string/.test(signature)) fautifs.push(`${CONFIG_REPOSITORY} → ${nom} : workspaceId manquant`);
      if (/workspaceId\?/.test(signature)) fautifs.push(`${CONFIG_REPOSITORY} → ${nom} : workspaceId ne doit jamais être optionnel`);
    }
    expect(fautifs).toEqual([]);
  });
});

describe("Frontière workspace — runners machine du moteur d'automatisation", () => {
  const CHEMINS_MACHINE = [
    ...FICHIERS_MOTEUR_AUTOMATISATION,
    ...listerFichiers(join(SRC, "app", "api", "automatisations"), (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)).map(
      (chemin) => relative(SRC, chemin).split(sep).join("/")
    ),
  ];

  // Aucune exception : ces chemins sont déclenchés par un cron externe porteur d'un secret Bearer.
  // Il n'y a pas de session à lire, et en simuler une reviendrait à attribuer le travail de tous au
  // périmètre du dernier humain connecté.
  it("aucun chemin machine ne dépend d'un workspace de session", () => {
    const fautifs = CHEMINS_MACHINE.filter((relatif) =>
      /\bexigerWorkspaceCourant\b/.test(codeSeul(join(SRC, ...relatif.split("/"))))
    ).map(
      (relatif) =>
        `${relatif} appelle exigerWorkspaceCourant() — chemin MACHINE (garde Bearer, aucune session) : ` +
        `le périmètre doit venir des données traitées ou de listerTousLesWorkspaceIds()`
    );
    expect(fautifs).toEqual([]);
  });

  // `resoudreWorkspaceExecutionMachine()` suppose qu'il n'existe QU'UN workspace et lève une
  // exception dès le second. La laisser dans un scanner rendrait le moteur muet pour tout le monde
  // le jour où un second workspace apparaît — exactement l'échec que ce lot supprime.
  it("aucun scanner ne suppose qu'il n'existe qu'un seul workspace", () => {
    const fautifs = FICHIERS_MOTEUR_AUTOMATISATION.filter((relatif) =>
      /\bresoudreWorkspaceExecutionMachine\b/.test(codeSeul(join(SRC, ...relatif.split("/"))))
    ).map(
      (relatif) =>
        `${relatif} appelle resoudreWorkspaceExecutionMachine(), qui échoue dès qu'un second workspace existe — ` +
        `le scan temporel est une passe PAR workspace (listerTousLesWorkspaceIds(), scanTemporel.ts)`
    );
    expect(fautifs).toEqual([]);
  });

  it("chaque scanner reçoit son workspace en premier paramètre, jamais optionnel", () => {
    const scanners = FICHIERS_MOTEUR_AUTOMATISATION.filter((relatif) =>
      relatif.startsWith("lib/automatisations/scanners/")
    );
    // La liste n'est pas vide : sinon la garde passerait en ne vérifiant rien.
    expect(scanners.length).toBeGreaterThanOrEqual(6);
    for (const relatif of scanners) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      const signature = /export async function scanner\w+\(([^)]*)\)/.exec(source)?.[1];
      expect(signature, `${relatif} : aucun scanner exporté trouvé`).toBeDefined();
      expect(signature, relatif).toContain("workspaceId: string");
      expect(signature?.trim().startsWith("workspaceId: string"), `${relatif} : workspaceId doit être le premier paramètre`).toBe(true);
    }
  });

  it("le registre de scan parcourt bien tous les workspaces", () => {
    const source = codeSeul(join(SRC, "lib", "automatisations", "scanTemporel.ts"));
    expect(source).toContain("listerTousLesWorkspaceIds");
    expect(source).not.toContain("resoudreWorkspaceExecutionMachine");
  });

  it("détecte un chemin machine qui se remettrait à lire la session", () => {
    // Même prédicat que la garde ci-dessus, appliqué à une source fabriquée.
    const faux = `const workspaceId = await exigerWorkspaceCourant();`;
    expect(/\bexigerWorkspaceCourant\b/.test(faux)).toBe(true);
    expect(/\bexigerWorkspaceCourant\b/.test(`const ids = await listerTousLesWorkspaceIds();`)).toBe(false);
  });
});
