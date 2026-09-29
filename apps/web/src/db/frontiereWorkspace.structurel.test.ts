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
      // (`getPhotoBien` retiré par WORKSPACE_SCOPING_V2C1 : la fonction n'existe plus, plus rien ne
      // peut l'importer — une entrée de liste noire visant un symbole supprimé ne protège rien.)
      for (const interdit of ["getDocumentBienById", "getBienById", "getClientById"]) {
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
// Catalogue recalculé par GLOBAL_READER_GUARD_EXTENSION_V1 (grep sur les exports réels, jamais
// recopié). `getEnvoiEmailById` n'y figure pas : il n'existe plus — il est devenu
// `getEnvoiEmailDuWorkspace`, la clé d'idempotence venant du navigateur.
const LECTEURS_NON_SCOPES = [
  "getBienById",
  "getClientById",
  "getProspectVendeurById",
  "getTacheById",
  "getDocumentBienById",
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
  // (WORKSPACE_SCOPING_V2D1 a retiré `actions/visite.ts`. Sa justification — « l'identifiant vient
  // du contexte Google Calendar du conseiller connecté, jamais d'un champ » — ne tenait plus : ce
  // contexte était produit par un rapprochement TEXTUEL contre le catalogue global, donc l'id
  // pouvait parfaitement désigner un bien d'un autre workspace. Le contexte est désormais résolu
  // dans le périmètre de session et les deux racines sont relues scopées. L'entrée a été RETIRÉE,
  // pas commentée — c'est la garde d'exception périmée qui l'a exigé.)

  // (WORKSPACE_SCOPING_V2A a refermé actions/prospectVendeur.ts, actions/repereRelationnel.ts et
  // actions/secteurRecherche.ts : leurs exceptions ont été retirées, pas commentées.)

  // ── V2, écrans de lecture seule : ce lot durcit les MUTATIONS et les routes qui servent des
  // fichiers. Une page hors périmètre affiche aujourd'hui une fiche qu'elle ne devrait pas
  // montrer ; elle ne permet plus, depuis ce lot, de la modifier.
  //
  // (WORKSPACE_SCOPING_V2C1 a refermé cinq de ces surfaces — biens/[id]/modifier, biens/[id]/photos,
  // clients/[id]/modifier, prospects-vendeurs/[id]/modifier et prospects-vendeurs/[id]/signer-mandat.
  // WORKSPACE_SCOPING_V2C2 a refermé les cinq dernières — biens/[id], clients/[id],
  // prospects-vendeurs/[id], offres/nouveau et compromis/nouveau. Dans les dix cas l'exception a été
  // RETIRÉE, pas commentée : chacune résout désormais le workspace AVANT sa racine et la lit par un
  // reader scopé.)
  //
  // Ce qui reste ci-dessous n'est PAS de la dette de même nature. Les deux surfaces Visite lisent
  // encore getBienById/getClientById, mais avec des identifiants dérivés d'une Visite (ou d'un Bon
  // de visite) déjà résolue dans le périmètre : la racine est prouvée, la feuille en découle. Elles
  // restent nommées ici précisément parce que « sûr par dérivation » est un raisonnement, pas une
  // garantie mécanique — le jour où la racine cesse d'être scopée, l'exception doit redevenir
  // visible.
  //
  // (WORKSPACE_SCOPING_V2D1 a retiré `/visites/[id]/preparer` : elle n'était PAS sûre par
  // dérivation — ses deux ids venaient d'un rapprochement TEXTUEL contre le catalogue global.
  // Elle résout désormais son périmètre en tête, dérive de la Visite canonique quand elle existe,
  // et relit ses deux racines scopées. L'exception a été RETIRÉE, pas commentée.)
  "app/visites/[id]/page.tsx": ["getBienById", "getClientById"],
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

// GLOBAL_READER_GUARD_EXTENSION_V1 — cette garde ne voyait que `app/**` et `actions/**`. C'était
// son ANGLE MORT : les fuites les plus durables ne vivaient pas dans les écrans mais dans les
// MODULES QUI LES ALIMENTENT. `lib/communications/contexteEcranCommunication.ts` recevait
// `tacheId` et `bienId` directement des searchParams et les passait à des lecteurs globaux — la
// garde des LISTES surveillait pourtant ce fichier, ce qui donnait l'illusion qu'il était couvert.
//
// La surface inclut donc désormais tout `lib/**`, à deux exclusions près :
//   - les `*Repository.ts`, qui DÉFINISSENT ces lecteurs (les interdire chez eux n'a pas de sens) ;
//   - les fichiers de test.
// Couvrir `lib/**` en entier plutôt qu'une liste de modules « user-facing » est délibéré : une
// liste à tenir à jour est exactement ce qui a produit l'angle mort. Le coût est une allowlist
// machine, qui reste minuscule (une entrée) et doit le rester.
const LECTEURS_MACHINE_UNITAIRES_AUTORISES: Record<string, { lecteurs: string[]; raison: string }> = {
  // Moteur d'automatisation : `construireTache` reçoit un ÉVÉNEMENT qui porte son propre
  // `workspaceId`, et chaque règle résout d'abord sa racine par un reader scopé
  // (`getCompteRenduVisiteById(id, evenement.workspaceId)`, qui joint `biens.workspace_id`). Les
  // lecteurs ci-dessous ne sont atteints qu'avec des ids DÉRIVÉS de cette racine prouvée. Aucune
  // entrée utilisateur n'entre dans ce chemin : il n'est jamais appelé depuis une session.
  "lib/automatisations/catalogueRegles.ts": {
    lecteurs: ["getBienById", "getClientById", "getProspectVendeurById"],
    raison: "moteur d'automatisation : ids dérivés d'un événement scopé, jamais d'une requête",
  },
};

describe("Frontière workspace — lecteurs non scopés hors des écrans et des actions", () => {
  const surfaces = [
    ...listerFichiers(join(SRC, "app"), (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c)),
    ...listerFichiers(join(SRC, "actions"), (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)),
    ...listerFichiers(
      join(SRC, "lib"),
      (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c) && !/[Rr]epository\.ts$/.test(c)
    ),
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
        if (LECTEURS_MACHINE_UNITAIRES_AUTORISES[relatif]?.lecteurs.includes(lecteur)) continue;
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

  // GLOBAL_READER_GUARD_EXTENSION_V1 — prouver que l'EXTENSION elle-même mord. Sans ces trois cas,
  // rien ne distinguerait « lib/** est couvert » de « lib/** est listé mais jamais lu ».
  it("la surface couvre bien les modules de lib/, pas seulement app/ et actions/", () => {
    const relatifs = surfaces.map((c) => relative(SRC, c).split(sep).join("/"));
    expect(relatifs).toContain("lib/communications/contexteEcranCommunication.ts");
    expect(relatifs).toContain("lib/communications/resoudreContexteCommunicationDepuisTache.ts");
    expect(relatifs).toContain("lib/compatibilite/synchronisation.ts");
    // …et n'inclut pas les repositories, qui DÉFINISSENT ces lecteurs.
    expect(relatifs.some((r) => /[Rr]epository\.ts$/.test(r))).toBe(false);
  });

  it("détecte un lecteur global réintroduit dans un module de contexte de lib/", () => {
    // Reproduit exactement la fuite refermée par ce lot : un id venu des searchParams passé à un
    // lecteur racine global depuis un module qui n'est ni un écran ni une action.
    const faux = `import { getTacheById } from "@/lib/tacheRepository";
      export async function resoudre(tacheId: string) { return getTacheById(tacheId); }`;
    const detectes = LECTEURS_NON_SCOPES.filter((lecteur) => new RegExp(`\\b${lecteur}\\b`).test(faux));
    expect(detectes).toEqual(["getTacheById"]);
    // Et ce fichier fictif n'a, par construction, aucune exception nommée qui le couvrirait.
    expect(EXCEPTIONS_JUSTIFIEES["lib/communications/faux.ts"]).toBeUndefined();
    expect(LECTEURS_MACHINE_UNITAIRES_AUTORISES["lib/communications/faux.ts"]).toBeUndefined();
  });

  it("chaque allowlist machine unitaire correspond à un usage réel : une entrée morte doit être retirée", () => {
    const mortes: string[] = [];
    for (const [relatif, { lecteurs }] of Object.entries(LECTEURS_MACHINE_UNITAIRES_AUTORISES)) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      for (const lecteur of lecteurs) {
        if (!new RegExp(`\\b${lecteur}\\b`).test(source)) mortes.push(`${relatif} → ${lecteur}`);
      }
    }
    expect(mortes).toEqual([]);
  });

  // Les trois modules de communication refermés par ce lot : plus aucune exception, et le périmètre
  // réellement porté jusqu'aux lectures.
  it("les modules de communication sont scopés et sans exception", () => {
    for (const relatif of [
      "lib/communications/contexteEcranCommunication.ts",
      "lib/communications/resoudreContexteCommunicationDepuisTache.ts",
      "lib/communications/destinataireCommunication.ts",
    ]) {
      expect(EXCEPTIONS_JUSTIFIEES[relatif], relatif).toBeUndefined();
      expect(LECTEURS_MACHINE_UNITAIRES_AUTORISES[relatif], relatif).toBeUndefined();
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      for (const lecteur of LECTEURS_NON_SCOPES) {
        expect(new RegExp(`\\b${lecteur}\\b`).test(source), `${relatif} → ${lecteur}`).toBe(false);
      }
      expect(source, `${relatif} doit porter le périmètre`).toContain("workspaceId");
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

// PLUS AUCUNE DETTE DE LECTEUR DE LISTE. Cet objet reste — vide — parce que c'est lui qui rend la
// règle lisible : une exception future devra être écrite ici, nommée et justifiée, jamais glissée
// dans un fichier.
//
// (WORKSPACE_SCOPING_V2C2 a retiré les quatre entrées V2C — biens/[id], clients/[id],
// offres/nouveau et compromis/nouveau. WORKSPACE_SCOPING_V2D1 a retiré la dernière,
// `lib/rendezVousContexte.ts` : le rapprochement des rendez-vous Google ne travaille plus sur le
// catalogue complet mais sur le seul référentiel du workspace de session. Le périmètre borne
// désormais le POOL DE CANDIDATS, pas le résultat — un bien d'un autre workspace n'est même plus
// évalué, alors qu'un simple score d'homonymie suffisait à rendre un rapprochement ambigu et à
// changer le verdict rendu à l'un à cause des données de l'autre.)
//
// ATTENTION — cela ne signifie PAS que la frontière Calendar est fermée : l'ÉVÉNEMENT lui-même
// vient toujours du compte Google connecté, qui reste un singleton d'instance
// (`connexions_google`, id 'default', ADR-054 §6). C'est la frontière DOMIORA qui est close ici ;
// la frontière de compte Google reste ouverte et attend V2D2.
const EXCEPTIONS_LISTE_JUSTIFIEES: Record<string, string[]> = {};

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

  // WORKSPACE_SCOPING_V2C2 — les cinq surfaces refermées par ce lot, nommées. La garde générique
  // ci-dessus les couvre déjà (leurs exceptions ont été retirées) ; celle-ci dit POURQUOI elles ne
  // doivent plus jamais en reprendre une, et échoue aussi si l'une d'elles cessait de résoudre son
  // périmètre — un lecteur scopé sans `exigerWorkspaceCourant` en amont ne scope rien.
  it("les cinq surfaces refermées par V2C2 n'ont plus aucune exception et résolvent leur périmètre", () => {
    for (const durci of [
      "app/biens/[id]/page.tsx",
      "app/clients/[id]/page.tsx",
      "app/prospects-vendeurs/[id]/page.tsx",
      "app/offres/nouveau/page.tsx",
      "app/compromis/nouveau/page.tsx",
    ]) {
      expect(EXCEPTIONS_LISTE_JUSTIFIEES[durci], durci).toBeUndefined();
      expect(EXCEPTIONS_JUSTIFIEES[durci], durci).toBeUndefined();
      const source = codeSeul(join(SRC, ...durci.split("/")));
      expect(source, durci).toContain("exigerWorkspaceCourant");
      expect(verifierSurface(durci, source), durci).toEqual([]);
      for (const interdit of LECTEURS_NON_SCOPES) {
        expect(new RegExp(`\\b${interdit}\\b`).test(source), `${durci} → ${interdit}`).toBe(false);
      }
    }
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
      ["lib/bienRepository.ts", "listerBiensActifsAvecPhotoDuWorkspace"],
      ["lib/tacheRepository.ts", "listerTachesDuBienDuWorkspace"],
      ["lib/tacheRepository.ts", "listerTachesDeLAcquereurDuWorkspace"],
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

// `onConflictDoUpdate({ target: [...] })` sur `memoireContextuelle` : la cible doit porter les
// TROIS colonnes. Même détection textuelle que pour les configurations d'automatisation — c'est
// exactement ce qui s'écrit à la main, et c'est là que la clé se perd.
function verifierCiblesMemoire(relatif: string, source: string): string[] {
  const fautifs: string[] = [];
  for (const m of source.matchAll(/onConflictDoUpdate\(\{\s*(?:\/\/[^\n]*\n\s*)*target:\s*(\[[^\]]*\]|[^\n]*)/g)) {
    const cible = m[1];
    const avant = source.slice(0, m.index ?? 0);
    const insertion = avant.lastIndexOf(".insert(");
    if (insertion === -1 || !/memoireContextuelle/.test(avant.slice(insertion))) continue;
    for (const colonne of ["workspaceId", "source", "identifiantExterne"]) {
      if (!new RegExp(`memoireContextuelle\\.${colonne}\\b`).test(cible)) {
        fautifs.push(
          `${relatif} : ON CONFLICT ciblant ${cible.trim()} — il manque memoireContextuelle.${colonne}. ` +
            `Depuis la migration 0055 la clé est le TRIPLET (workspaceId, source, identifiantExterne) ; ` +
            `cibler le couple ferait écraser la décision d'un autre workspace.`
        );
      }
    }
  }
  return fautifs;
}

// ───────────────── 4bis. MÉMOIRE CONTEXTUELLE PAR WORKSPACE ─────────────────

// WORKSPACE_SCOPING_V2D1 (migration 0055) — `memoire_contextuelle` mémorise, pour un élément
// externe (un événement Google Calendar), à quel bien et à quel acquéreur il correspond. Son
// unicité était GLOBALE : `(source, identifiant_externe)`. Deux workspaces ne pouvaient donc pas
// mémoriser le même événement, et l'`ON CONFLICT` du writer faisait écraser la décision HUMAINE de
// l'un par le cache automatique de l'autre — puis la relecture rendait à l'un le `bien_id` de
// l'autre. Exactement la faille que 0054 a refermée pour `configurations_automatisation`.
//
// Deux gardes, parce que la clé peut se perdre de deux façons : par la CIBLE d'un upsert Drizzle,
// et par une LECTURE qui oublierait le périmètre dans son `where`.
const MEMOIRE_REPOSITORY = "lib/contexteRepository.ts";

describe("Frontière workspace — mémoire contextuelle par workspace", () => {
  const sourceMemoire = () => codeSeul(join(SRC, ...MEMOIRE_REPOSITORY.split("/")));

  it("tout ON CONFLICT sur la mémoire cible le TRIPLET, jamais (source, identifiantExterne)", () => {
    const fautifs = verifierCiblesMemoire(MEMOIRE_REPOSITORY, sourceMemoire());
    expect(fautifs).toEqual([]);
  });

  // Prouver la CAPACITÉ DE DÉTECTION : une garde qui ne ferait que constater l'état du dépôt
  // passerait encore si elle était vide.
  it("détecte une cible d'upsert revenue au couple", () => {
    const faux = `await getDb().insert(memoireContextuelle).values(v).onConflictDoUpdate({
      target: [memoireContextuelle.source, memoireContextuelle.identifiantExterne],
      set: v,
    });`;
    const fautifs = verifierCiblesMemoire("lib/faux.ts", faux);
    expect(fautifs).toHaveLength(1);
    expect(fautifs[0]).toContain("workspaceId");
  });

  it("aucune lecture de la mémoire ne filtre sans le périmètre", () => {
    const source = sourceMemoire();
    // Chaque `.from(memoireContextuelle)` doit être suivi, dans la même instruction, d'une
    // contrainte sur `workspaceId`. Découpe à l'instruction : `;` termine chaque requête Drizzle.
    const fautifs: string[] = [];
    for (const instruction of source.split(";")) {
      if (!/\.from\(memoireContextuelle\)/.test(instruction)) continue;
      if (!/memoireContextuelle\.workspaceId/.test(instruction)) {
        fautifs.push(
          `${MEMOIRE_REPOSITORY} : lecture de memoire_contextuelle sans eq(memoireContextuelle.workspaceId, ...) — ` +
            `la clé est le triplet (workspace_id, source, identifiant_externe) depuis la migration 0055.`
        );
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("toute fonction exportée du repository de mémoire exige un workspaceId", () => {
    const source = sourceMemoire();
    const sansPerimetre: string[] = [];
    for (const bloc of source.split(/(?=export async function )/)) {
      const nom = /^export async function (\w+)/.exec(bloc)?.[1];
      if (!nom) continue;
      const signature = bloc.slice(0, bloc.indexOf(")", bloc.indexOf("(")) + 1);
      const complete = bloc.slice(0, bloc.indexOf("): "));
      if (!/workspaceId: string/.test(complete) && !/workspaceId: string/.test(signature)) {
        sansPerimetre.push(`${MEMOIRE_REPOSITORY} → ${nom}`);
      }
    }
    expect(sansPerimetre).toEqual([]);
  });
});

// ───────────────── 4ter. FRONTIÈRE DE COMPTE GOOGLE (IDENTITÉ) ─────────────────

// WORKSPACE_SCOPING_V2D2 (ADR-054 §6) — toutes les gardes ci-dessus raisonnent sur le WORKSPACE.
// Celle-ci raisonne sur l'IDENTITÉ, et c'est une frontière différente : un refresh token Google
// appartient à la personne qui l'a accordé, jamais au workspace ni à l'instance. Confondre les deux
// ferait d'un secret personnel un actif partagé.
//
// Jusqu'à ce lot, `connexions_google` était un SINGLETON (`id = 'default'`) : le second membre qui
// connectait Google écrasait le token du premier, le premier logout révoquait pour tout le monde,
// et chaque lecture Calendar/Gmail tapait sur le compte du dernier connecté. Ces gardes empêchent
// le retour de l'une ou l'autre forme de ce défaut.
const CONNEXION_GOOGLE_REPOSITORY = "lib/google/connexion.ts";

// Le dossier Google entier, plus les surfaces machine qui ne doivent jamais y toucher.
const SURFACES_MACHINE = [
  "app/api/automatisations/scan/route.ts",
  "app/api/automatisations/reprise/route.ts",
  "app/api/compatibilite/scan/route.ts",
  "app/api/compatibilite/baseline/route.ts",
  ...listerFichiers(join(SRC, "lib", "automatisations"), (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)).map((chemin) =>
    relative(SRC, chemin).split(sep).join("/")
  ),
];

describe("Frontière d'identité — connexion Google personnelle", () => {
  const sourceConnexion = () => codeSeul(join(SRC, ...CONNEXION_GOOGLE_REPOSITORY.split("/")));

  it("toute fonction exportée du repository de connexion exige un identiteSub", () => {
    const sansIdentite: string[] = [];
    for (const bloc of sourceConnexion().split(/(?=export async function )/)) {
      const nom = /^export async function (\w+)/.exec(bloc)?.[1];
      if (!nom) continue;
      const signature = bloc.slice(0, bloc.indexOf("): "));
      if (!/identiteSub: string/.test(signature)) sansIdentite.push(`${CONNEXION_GOOGLE_REPOSITORY} → ${nom}`);
      expect(signature, `${nom} : identiteSub ne doit jamais être optionnel`).not.toContain("identiteSub?");
    }
    expect(sansIdentite).toEqual([]);
  });

  // Le singleton ne revient pas par une constante rebaptisée : ce qui est interdit, c'est qu'une
  // requête sur cette table vise une valeur littérale plutôt que l'identité reçue en paramètre.
  it("aucun identifiant de connexion en dur : le singleton ne peut pas revenir", () => {
    const source = sourceConnexion();
    expect(source, "ID_CONNEXION était la clé du singleton — ne jamais la réintroduire").not.toContain("ID_CONNEXION");
    expect(source, "aucune connexion ne s'identifie par le littéral 'default'").not.toMatch(/["'`]default["'`]/);
  });

  it("toute lecture ou suppression de connexions_google porte l'identité", () => {
    const fautifs: string[] = [];
    for (const instruction of sourceConnexion().split(";")) {
      const touche = /\.from\(connexionsGoogle\)/.test(instruction) || /\.delete\(connexionsGoogle\)/.test(instruction);
      if (!touche) continue;
      if (!/connexionsGoogle\.identiteSub/.test(instruction)) {
        fautifs.push(
          `${CONNEXION_GOOGLE_REPOSITORY} : accès à connexions_google sans eq(connexionsGoogle.identiteSub, ...) — ` +
            `un SELECT ou un DELETE global rendrait (ou supprimerait) le token de quelqu'un d'autre.`
        );
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("tout ON CONFLICT sur la connexion cible l'identité, jamais une clé d'instance", () => {
    const cibles = [...sourceConnexion().matchAll(/onConflictDoUpdate\(\{\s*target:\s*([^\n,]*)/g)].map((m) => m[1]);
    expect(cibles.length, "l'upsert de connexion doit exister").toBeGreaterThan(0);
    for (const cible of cibles) {
      expect(
        cible,
        `ON CONFLICT ciblant ${cible.trim()} — la clé d'une connexion est l'identité ; toute autre cible ` +
          `fait écraser le token d'une autre personne (c'était le défaut du singleton).`
      ).toContain("connexionsGoogle.identiteSub");
    }
  });

  // Un chemin machine n'a aucune identité à présenter : s'il acquérait un token Google, il devrait
  // en choisir un — c'est-à-dire emprunter le compte de quelqu'un. L'audit V2D2 a établi qu'aucun
  // n'y touche aujourd'hui ; cette garde empêche que cela change sans décision explicite.
  it("aucune surface machine n'importe le domaine Google", () => {
    const fautifs: string[] = [];
    for (const relatif of SURFACES_MACHINE) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      if (/from "@\/lib\/google\//.test(source) || /from "\.\.?\/google\//.test(source)) {
        fautifs.push(
          `${relatif} importe lib/google/** — un chemin machine n'a pas d'identité, il ne peut donc pas ` +
            `choisir un compte Google sans emprunter celui de quelqu'un.`
        );
      }
    }
    expect(fautifs).toEqual([]);
  });

  // Capacité de détection, sur des sources fabriquées : une garde qui ne ferait que constater
  // l'état du dépôt passerait encore si elle était vide.
  it("détecte un upsert revenu à une clé d'instance et une lecture sans identité", () => {
    const fauxUpsert = `.onConflictDoUpdate({ target: connexionsGoogle.id, set: v });`;
    expect([...fauxUpsert.matchAll(/onConflictDoUpdate\(\{\s*target:\s*([^\n,]*)/g)][0][1]).not.toContain(
      "connexionsGoogle.identiteSub"
    );
    const fausseLecture = `const [l] = await getDb().select().from(connexionsGoogle).limit(1);`;
    expect(/\.from\(connexionsGoogle\)/.test(fausseLecture)).toBe(true);
    expect(/connexionsGoogle\.identiteSub/.test(fausseLecture)).toBe(false);
  });
});

// ───────────────── 4quater. FRONTIÈRE FISCALE PERSONNELLE ─────────────────

// FISCAL_IDENTITY_OWNERSHIP_V1 (ADR-054 §6 bis, ADR-023 §1) — le dossier fiscal appartient à une
// PERSONNE, jamais à un workspace. Deux défauts distincts sont verrouillés ici, parce qu'ils se
// réintroduisent de deux façons différentes :
//
//   1. le SINGLETON : un dossier résolu sans dire de qui (`obtenirDossierFiscalDefaut()`,
//      `id = 'default'`) — deux conseillers partageaient alors un régime micro-BNC, une option TVA
//      et un revenu fiscal de référence de FOYER, et la saisie de l'un écrasait celle de l'autre ;
//   2. l'ASSIETTE GLOBALE : un calcul fiscal personnel alimenté par un lecteur d'encaissements sans
//      bénéficiaire — le dossier serait nominativement personnel, mais nourri du chiffre d'affaires
//      de tout le monde.
const REPOSITORY_DOSSIER_FISCAL = "lib/dossierFiscalRepository.ts";

// Lecteurs d'encaissements SANS bénéficiaire. Ils restent légitimes hors du fiscal (le dashboard
// montre l'activité d'un workspace, pas le revenu d'une personne) : ce qui est interdit, c'est leur
// usage depuis `lib/fiscal/**`.
const LECTEURS_ENCAISSEMENTS_GLOBAUX = ["listerEncaissementsAnnee", "listerEncaissementsDepuis"];

const MODULES_FISCAUX = listerFichiers(
  join(SRC, "lib", "fiscal"),
  (c) => /\.ts$/.test(c) && !/\.test\.ts$/.test(c)
).map((chemin) => relative(SRC, chemin).split(sep).join("/"));

describe("Frontière d'identité — dossier fiscal personnel", () => {
  const sourceDossier = () => codeSeul(join(SRC, ...REPOSITORY_DOSSIER_FISCAL.split("/")));

  it("toute fonction exportée du repository fiscal exige une identité", () => {
    const sansIdentite: string[] = [];
    for (const bloc of sourceDossier().split(/(?=export async function )/)) {
      const nom = /^export async function (\w+)/.exec(bloc)?.[1];
      if (!nom) continue;
      const signature = bloc.slice(0, bloc.indexOf("): "));
      if (!/identiteSub: string/.test(signature)) sansIdentite.push(`${REPOSITORY_DOSSIER_FISCAL} → ${nom}`);
      expect(signature, `${nom} : identiteSub ne doit jamais être optionnel`).not.toContain("identiteSub?");
    }
    expect(sansIdentite).toEqual([]);
  });

  it("le singleton fiscal ne peut pas revenir", () => {
    const source = sourceDossier();
    expect(source, "obtenirDossierFiscalDefaut résolvait « le » dossier sans dire de qui").not.toContain(
      "obtenirDossierFiscalDefaut"
    );
    // Ciblé : le littéral qui SERVAIT d'identité au dossier. On ne bannit pas toutes les chaînes
    // "default" du dépôt — le workspace historique porte légitimement cet identifiant.
    expect(source, "aucun dossier fiscal ne s'identifie par un littéral").not.toMatch(/["'`]default["'`]/);
    expect(source, "DOSSIER_FISCAL_ID_DEFAUT était la constante du singleton").not.toContain(
      "DOSSIER_FISCAL_ID_DEFAUT"
    );
  });

  it("toute lecture du dossier fiscal porte l'identité", () => {
    const fautifs: string[] = [];
    for (const instruction of sourceDossier().split(";")) {
      if (!/\.from\(dossierFiscalTable\)/.test(instruction)) continue;
      if (!/dossierFiscalTable\.identiteSub/.test(instruction)) {
        fautifs.push(
          `${REPOSITORY_DOSSIER_FISCAL} : lecture de dossier_fiscal sans eq(dossierFiscalTable.identiteSub, ...) — ` +
            `un dossier fiscal atteint sans identité est l'ancien singleton.`
        );
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("aucun module fiscal n'utilise un lecteur d'encaissements sans bénéficiaire", () => {
    const fautifs: string[] = [];
    for (const relatif of MODULES_FISCAUX) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      for (const lecteur of LECTEURS_ENCAISSEMENTS_GLOBAUX) {
        // `listerEncaissementsAnneePourIdentite` contient `listerEncaissementsAnnee` : on exige donc
        // que le nom ne soit PAS suivi de `PourIdentite`.
        if (new RegExp(`\\b${lecteur}\\b(?!PourIdentite)`).test(source)) {
          fautifs.push(
            `${relatif} → ${lecteur} : une assiette fiscale personnelle ne peut pas être alimentée par ` +
              `un lecteur sans bénéficiaire — utiliser ${lecteur}PourIdentite(identiteSub, ...).`
          );
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("tout module fiscal qui lit des encaissements porte une identité", () => {
    const fautifs: string[] = [];
    for (const relatif of MODULES_FISCAUX) {
      const source = codeSeul(join(SRC, ...relatif.split("/")));
      if (!/listerEncaissements\w*PourIdentite/.test(source)) continue;
      if (!/identiteSub/.test(source)) fautifs.push(`${relatif} : lit des encaissements sans porter identiteSub`);
    }
    expect(fautifs).toEqual([]);
  });

  // Capacité de détection, sur des sources fabriquées : une garde qui ne ferait que constater
  // l'état du dépôt passerait encore si elle était vide.
  it("détecte un singleton fiscal et un lecteur d'encaissements global réintroduits", () => {
    const fauxSingleton = `const id = "default"; await obtenirDossierFiscalDefaut();`;
    expect(/["'\`]default["'\`]/.test(fauxSingleton)).toBe(true);
    expect(fauxSingleton.includes("obtenirDossierFiscalDefaut")).toBe(true);

    const fauxCalcul = `const e = await listerEncaissementsAnnee(annee);`;
    const detecte = LECTEURS_ENCAISSEMENTS_GLOBAUX.filter((l) =>
      new RegExp(`\\b${l}\\b(?!PourIdentite)`).test(fauxCalcul)
    );
    expect(detecte).toEqual(["listerEncaissementsAnnee"]);

    // …et la forme scopée ne doit PAS être détectée comme fautive.
    const vraiCalcul = `const e = await listerEncaissementsAnneePourIdentite(identiteSub, annee);`;
    const fauxPositifs = LECTEURS_ENCAISSEMENTS_GLOBAUX.filter((l) =>
      new RegExp(`\\b${l}\\b(?!PourIdentite)`).test(vraiCalcul)
    );
    expect(fauxPositifs).toEqual([]);
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
