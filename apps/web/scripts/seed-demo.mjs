// Seed de démonstration DOMIORA (DEMO-02) — script autonome, même patron que
// scripts/backfill-code-insee-commune.mjs (aucune dépendance aux alias "@/", exécutable hors
// Next.js). Destiné à une instance de DÉMONSTRATION dédiée, jamais à une base portant de vraies
// données.
//
// Usage :
//   DOMIORA_DEMO_SEED_CONFIRM=I_UNDERSTAND_THIS_IS_DEMO_DATA DATABASE_URL=... pnpm db:seed:demo
//
// Pourquoi un script SQL direct plutôt que les Server Actions : celles-ci exigent toutes une
// session Atlas (ADR-047, exigerSessionAtlas en première ligne) — un seed n'a pas d'utilisateur.
// Les invariants applicatifs qu'elles portent sont donc reproduits explicitement ici (jalons
// biens.offreEnCoursLe/compromisSigneLe posés avec l'offre et le compromis, lien offre_visites
// avec dateVisite <= dateOffre, un seul compromis en_cours par bien).
//
// DEUX GARDES INDÉPENDANTES, toutes deux sur le chemin d'écriture (jamais seulement dans la CLI) :
//   1. confirmation explicite par variable d'environnement, jamais de valeur par défaut ;
//   2. refus si UNE SEULE ligne métier non reconnue comme appartenant à ce dataset existe déjà.
// Aucune suppression, aucun TRUNCATE, aucun --force, aucun mode reset : ce script ne sait
// qu'ajouter, et uniquement sur une base métier vierge.

import postgres from "postgres";
import { pathToFileURL } from "node:url";

export const NOM_VARIABLE_CONFIRMATION = "DOMIORA_DEMO_SEED_CONFIRM";
export const VALEUR_CONFIRMATION_ATTENDUE = "I_UNDERSTAND_THIS_IS_DEMO_DATA";

// Fuseau de l'application (src/lib/temps.ts, FUSEAU_HORAIRE_APP) — les dates relatives du dataset
// doivent correspondre au "aujourd'hui" que l'application affiche, jamais à un aujourd'hui UTC qui
// décalerait les échéances d'un jour en soirée.
const FUSEAU_APP = "Europe/Paris";

export class ErreurSeedDemo extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ErreurSeedDemo";
    this.code = code;
  }
}

// UUID déterministes : ils sont à eux seuls le marqueur d'appartenance au dataset. Reconnaître nos
// lignes par leur identifiant est exact et ne dépend d'aucune convention de texte qu'une saisie
// humaine pourrait imiter par accident. Forme UUID valide (version 4, variante 8).
function uuidDemo(index) {
  return `d0d0d0d0-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export const IDS = {
  prospects: [uuidDemo(101), uuidDemo(102), uuidDemo(103)],
  acquereurs: [uuidDemo(201), uuidDemo(202), uuidDemo(203), uuidDemo(204)],
  biens: [uuidDemo(301), uuidDemo(302)],
  secteurs: [uuidDemo(401), uuidDemo(402), uuidDemo(403), uuidDemo(404)],
  visites: [uuidDemo(501), uuidDemo(502)],
  comptesRendus: [uuidDemo(601)],
  offres: [uuidDemo(701)],
  offreVisites: [uuidDemo(801)],
  compromis: [uuidDemo(901)],
  remunerations: [uuidDemo(1001)],
  taches: [
    uuidDemo(1101),
    uuidDemo(1102),
    uuidDemo(1103),
    uuidDemo(1104),
    uuidDemo(1105),
    uuidDemo(1106),
    uuidDemo(1107),
  ],
  notesBien: [uuidDemo(1201)],
  notesProspect: [uuidDemo(1202)],
};

// Tables métier inspectées par la garde n°2. Volontairement limitée aux entités métier réelles :
// jamais regle_fiscale (référentiel livré par la migration 0015), jamais dossier_fiscal /
// configurations_automatisation (lignes de configuration), dont la présence est normale sur une
// base fraîchement migrée et ne doit rien bloquer.
// documents_bien et photos_bien sont inspectées avec zéro ligne attendue : ce seed n'en crée aucune
// (aucun fichier réel à écrire, voir README), donc toute ligne présente y est forcément étrangère.
const TABLES_METIER = [
  { table: "biens", ids: IDS.biens },
  { table: "acquereurs", ids: IDS.acquereurs },
  { table: "secteurs_recherche_acquereur", ids: IDS.secteurs },
  { table: "prospects_vendeurs", ids: IDS.prospects },
  { table: "visites", ids: IDS.visites },
  { table: "comptes_rendus_visite", ids: IDS.comptesRendus },
  { table: "offres", ids: IDS.offres },
  { table: "offre_visites", ids: IDS.offreVisites },
  { table: "compromis", ids: IDS.compromis },
  { table: "remuneration", ids: IDS.remunerations },
  { table: "taches", ids: IDS.taches },
  { table: "notes_bien", ids: IDS.notesBien },
  { table: "notes_prospect_vendeur", ids: IDS.notesProspect },
  { table: "documents_bien", ids: [] },
  { table: "photos_bien", ids: [] },
];

function decaler(base, jours) {
  const date = new Date(base.getTime());
  date.setUTCDate(date.getUTCDate() + jours);
  return date;
}

// Date civile "YYYY-MM-DD" dans le fuseau de l'application — même primitive que formatDateISO().
function jour(base, jours) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU_APP }).format(decaler(base, jours));
}

function instant(base, jours) {
  return decaler(base, jours);
}

// Dataset complet et purement descriptif — aucune I/O, testable seul. `maintenant` est injecté :
// les dates relatives ne sont calculées qu'au premier run (le second sort avant toute écriture),
// l'idempotence ne dépend donc jamais de l'heure d'exécution.
export function construireDataset(maintenant) {
  const [p1, p2, p3] = IDS.prospects;
  const [a1, a2, a3, a4] = IDS.acquereurs;
  const [b1, b2] = IDS.biens;
  const [v1, v2] = IDS.visites;
  const [cr1] = IDS.comptesRendus;
  const [o1] = IDS.offres;
  const [c1] = IDS.compromis;
  const [r1] = IDS.remunerations;

  return {
    // Trois vendeurs à trois stades distincts. Le premier est délibérément laissé à
    // "mandat proposé" : c'est lui que la démonstration convertit EN DIRECT (signature du mandat
    // -> création automatique du Bien), donc son bien ne doit surtout pas être seedé.
    prospects: [
      {
        id: p1,
        nom: "Vasseur",
        prenom: "Hélène",
        email: "helene.vasseur@example.test",
        telephone: "0100000101",
        origineLead: "recommandation",
        origineLeadDetail: "Recommandée par un vendeur accompagné en 2025",
        adresseBienPotentiel: "8 rue du Clos Fictif",
        secteurBienPotentiel: "Sartrouville centre",
        ville: "Sartrouville",
        codePostal: "78500",
        typeBien: "maison",
        qualifieLe: instant(maintenant, -21),
        rdvEstimationPrevuLe: instant(maintenant, -16),
        rdvEstimationRealiseLe: instant(maintenant, -16),
        estimationProposeeCentimes: 62_500_000,
        estimationProposeeLe: jour(maintenant, -14),
        mandatProposeLe: instant(maintenant, -6),
        mandatSigneLe: null,
        bienId: null,
        motifPerte: null,
        datePerte: null,
        dernierContactLe: instant(maintenant, -6),
        creeLe: instant(maintenant, -24),
      },
      {
        id: p2,
        nom: "Roncier",
        prenom: "Damien",
        email: "damien.roncier@example.test",
        telephone: "0100000102",
        origineLead: "site_web",
        origineLeadDetail: "Formulaire d'estimation en ligne",
        adresseBienPotentiel: "22 avenue des Peupliers Fictive",
        secteurBienPotentiel: "Carrières-sur-Seine",
        ville: "Carrières-sur-Seine",
        codePostal: "78420",
        typeBien: "appartement",
        qualifieLe: instant(maintenant, -30),
        rdvEstimationPrevuLe: instant(maintenant, -25),
        rdvEstimationRealiseLe: instant(maintenant, -25),
        estimationProposeeCentimes: 31_800_000,
        estimationProposeeLe: jour(maintenant, -23),
        mandatProposeLe: null,
        mandatSigneLe: null,
        bienId: null,
        motifPerte: null,
        datePerte: null,
        dernierContactLe: instant(maintenant, -4),
        creeLe: instant(maintenant, -33),
      },
      {
        id: p3,
        nom: "Lantier",
        prenom: "Sofia",
        email: "sofia.lantier@example.test",
        telephone: "0100000103",
        origineLead: "prospection_terrain",
        origineLeadDetail: "Boîtage secteur gare",
        adresseBienPotentiel: "5 impasse des Vergers Fictive",
        secteurBienPotentiel: "Houilles",
        ville: "Houilles",
        codePostal: "78800",
        typeBien: "appartement",
        qualifieLe: instant(maintenant, -60),
        rdvEstimationPrevuLe: instant(maintenant, -52),
        rdvEstimationRealiseLe: instant(maintenant, -52),
        estimationProposeeCentimes: 29_500_000,
        estimationProposeeLe: jour(maintenant, -50),
        mandatProposeLe: instant(maintenant, -46),
        mandatSigneLe: null,
        bienId: null,
        // Un pipeline sans aucun échec ne ressemble à aucune activité réelle.
        motifPerte: "choix_agence_concurrente",
        datePerte: jour(maintenant, -35),
        dernierContactLe: instant(maintenant, -52),
        creeLe: instant(maintenant, -64),
      },
    ],

    // Deux biens seulement : le pivot (matching) et le dossier avancé (offre -> compromis). Le
    // troisième naît en direct de la signature du mandat d'Hélène Vasseur.
    biens: [
      {
        id: b1,
        reference: "DEMO-2026-001",
        titre: "Appartement 4 pièces avec balcon — proche gare",
        type: "appartement",
        adresse: "14 rue des Tilleuls Fictifs",
        ville: "Houilles",
        codePostal: "78800",
        codeInseeCommune: "78311",
        surface: 82,
        pieces: 4,
        prix: 389_000,
        statutMandat: "actif",
        dateMandat: jour(maintenant, -45),
        caracteristiques: [
          "Double exposition est-ouest",
          "Cuisine ouverte équipée",
          "Balcon de 6 m²",
          "Cave",
          "Place de parking en sous-sol",
          "Charges 180 €/mois",
        ],
        description:
          "Quatre pièces traversant au deuxième étage d'une petite copropriété, à sept minutes à pied de la gare.",
        etage: 2,
        // Volontairement INCONNU (NULL), jamais false : c'est ce qui fait ressortir un acquéreur
        // "à vérifier" plutôt qu'"incompatible" (ADR-009, inconnu != non) — l'invariant que la
        // démonstration doit pouvoir montrer, pas une donnée oubliée.
        ascenseur: null,
        parking: true,
        exterieur: "balcon",
        chargeHonoraires: "vendeur",
        nomCopropriete: "Résidence des Tilleuls",
        offreEnCoursLe: null,
        compromisSigneLe: null,
        creeLe: instant(maintenant, -45),
      },
      {
        id: b2,
        reference: "DEMO-2026-002",
        titre: "Maison familiale 5 pièces avec jardin",
        type: "maison",
        adresse: "3 allée des Charmes Fictive",
        ville: "Maisons-Laffitte",
        codePostal: "78600",
        codeInseeCommune: "78358",
        surface: 128,
        pieces: 5,
        prix: 745_000,
        statutMandat: "actif",
        dateMandat: jour(maintenant, -120),
        caracteristiques: [
          "Jardin clos de 320 m²",
          "Garage double",
          "Cuisine indépendante",
          "Combles aménageables",
          "Chaudière remplacée en 2023",
        ],
        description:
          "Maison familiale sur trois niveaux, jardin clos sans vis-à-vis, à proximité des écoles.",
        etage: null,
        ascenseur: null,
        parking: true,
        exterieur: "jardin",
        chargeHonoraires: "acquereur",
        nomCopropriete: null,
        // Jalons posés exactement comme le feraient ajouterOffreAction et ajouterCompromisAction
        // (ADR-014) — jamais un statut commercial stocké, toujours ces deux timestamps.
        offreEnCoursLe: instant(maintenant, -6),
        compromisSigneLe: instant(maintenant, -2),
        creeLe: instant(maintenant, -120),
      },
    ],

    // Quatre acquéreurs construits pour que le moteur de compatibilité (ADR-034/035, fonction pure
    // evaluerCompatibilite) produise LUI-MÊME les trois états sur le bien pivot. Aucun statut n'est
    // persisté : tout est recalculé à l'affichage.
    acquereurs: [
      {
        id: a1,
        prenom: "Camille",
        nom: "Ferrand",
        email: "camille.ferrand@example.test",
        telephone: "0100000001",
        budgetMin: 320_000,
        budgetMax: 420_000,
        criteres: ["Proximité gare", "Balcon ou terrasse", "Stationnement"],
        stadeProjet: "recherche_active",
        notes: "Prêt bancaire accordé, disponible pour visiter en semaine.",
        datePremiereContact: jour(maintenant, -38),
        piecesMin: 3,
        surfaceMin: 70,
        accessibiliteRequise: null,
        necessiteParking: true,
        necessiteExterieur: true,
        creeLe: instant(maintenant, -38),
        secteur: { id: IDS.secteurs[0], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" },
      },
      {
        id: a2,
        prenom: "Yanis",
        nom: "Delaunay",
        email: "yanis.delaunay@example.test",
        telephone: "0100000002",
        budgetMin: 300_000,
        budgetMax: 400_000,
        criteres: ["Étage accessible", "Proche transports"],
        stadeProjet: "recherche_active",
        notes: "Recherche un logement réellement accessible — l'ascenseur est une condition.",
        datePremiereContact: jour(maintenant, -24),
        piecesMin: 3,
        surfaceMin: 75,
        // Seul critère qui bascule le couple avec le bien pivot en "à vérifier" : l'étage est
        // connu (2), l'ascenseur ne l'est pas.
        accessibiliteRequise: true,
        necessiteParking: null,
        necessiteExterieur: null,
        creeLe: instant(maintenant, -24),
        secteur: { id: IDS.secteurs[1], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" },
      },
      {
        id: a3,
        prenom: "Noémie",
        nom: "Bassot",
        email: "noemie.bassot@example.test",
        telephone: "0100000003",
        budgetMin: 180_000,
        budgetMax: 250_000,
        criteres: ["Premier achat", "Budget serré"],
        stadeProjet: "decouverte",
        notes: "Premier achat, financement en cours de montage.",
        datePremiereContact: jour(maintenant, -11),
        piecesMin: 2,
        surfaceMin: 45,
        accessibiliteRequise: null,
        necessiteParking: null,
        necessiteExterieur: null,
        creeLe: instant(maintenant, -11),
        secteur: { id: IDS.secteurs[2], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" },
      },
      {
        id: a4,
        prenom: "Théo",
        nom: "Marchand",
        email: "theo.marchand@example.test",
        telephone: "0100000004",
        budgetMin: 650_000,
        budgetMax: 780_000,
        criteres: ["Maison familiale", "Jardin", "Proche écoles"],
        stadeProjet: "compromis",
        notes: "Compromis signé sur la maison de Maisons-Laffitte.",
        datePremiereContact: jour(maintenant, -95),
        piecesMin: 4,
        surfaceMin: 110,
        accessibiliteRequise: null,
        necessiteParking: null,
        necessiteExterieur: true,
        creeLe: instant(maintenant, -95),
        secteur: {
          id: IDS.secteurs[3],
          codeInsee: "78358",
          nomCommune: "Maisons-Laffitte",
          codePostal: "78600",
        },
      },
    ],

    // rendezVousCalendarId est NOT NULL UNIQUE en base : ces identifiants sont explicitement des
    // marqueurs de seed, jamais des identifiants Google Calendar. Conséquence assumée et
    // documentée dans le README : la fiche visite /visites/[id] est pleinement consultable (elle
    // ne lit que Postgres), mais /visites/[id]/preparer ne peut pas résoudre un rendez-vous
    // Calendar inexistant et rend un 404 propre.
    visites: [
      {
        id: v1,
        bienId: b2,
        acquereurId: a4,
        datePrevue: jour(maintenant, -9),
        statut: "realisee",
        rendezVousCalendarId: "demo-seed-visite-001",
        creeLe: instant(maintenant, -12),
      },
      {
        id: v2,
        bienId: b1,
        acquereurId: a1,
        datePrevue: jour(maintenant, 4),
        statut: "planifiee",
        rendezVousCalendarId: "demo-seed-visite-002",
        creeLe: instant(maintenant, -2),
      },
    ],

    comptesRendus: [
      {
        id: cr1,
        bienId: b2,
        acquereurId: a4,
        visiteId: v1,
        dateVisite: jour(maintenant, -9),
        retour:
          "Le jardin et le volume du séjour ont emporté la décision. Réserve initiale sur la cuisine à rafraîchir, levée après un second passage le lendemain.",
        interet: "interesse",
        prochaineEtape: "Faire une offre écrite",
        creeLe: instant(maintenant, -9),
      },
    ],

    offres: [
      {
        id: o1,
        bienId: b2,
        acquereurId: a4,
        montant: 730_000,
        dateOffre: jour(maintenant, -6),
        statut: "acceptee",
        dateValidite: jour(maintenant, 4),
        dateDecision: jour(maintenant, -4),
        motifPerte: null,
        creeLe: instant(maintenant, -6),
      },
    ],

    // Lien visite -> offre (ADR-019). Invariant porté par la Server Action et reproduit ici :
    // dateVisite (J-9) <= dateOffre (J-6), même bien et même acquéreur des deux côtés.
    offreVisites: [{ id: IDS.offreVisites[0], offreId: o1, compteRenduVisiteId: cr1, creeLe: instant(maintenant, -6) }],

    compromis: [
      {
        id: c1,
        bienId: b2,
        acquereurId: a4,
        offreId: o1,
        prixConvenu: 730_000,
        dateSignature: jour(maintenant, -2),
        dateActe: jour(maintenant, 75),
        dateActeReelle: null,
        dateAnnulation: null,
        motifAnnulation: null,
        statut: "en_cours",
        creeLe: instant(maintenant, -2),
      },
    ],

    // Honoraires 3 % du prix convenu, part conseiller 70 % — montants en centimes entiers.
    // Aucune date d'encaissement réelle : le dashboard doit montrer un prévisionnel, pas un encaissé.
    remunerations: [
      {
        id: r1,
        compromisId: c1,
        montantHonorairesTotalCentimes: 2_190_000,
        montantRemunerationConseillerCentimes: 1_533_000,
        dateEncaissementPrevue: jour(maintenant, 75),
        dateEncaissementReelle: null,
        creeLe: instant(maintenant, -2),
      },
    ],

    // Sept tâches : deux réellement en retard, quatre à venir, une terminée. Échéances jamais
    // posées au jour même — joursRestants() (src/lib/tachePriority.ts) compare une date civile à
    // un instant, une échéance du jour basculerait "en retard" en cours de journée.
    taches: [
      {
        id: IDS.taches[0],
        titre: "Relancer Hélène Vasseur sur la proposition de mandat",
        contexte: "Mandat proposé il y a 6 jours, sans réponse depuis.",
        type: "relance",
        priorite: "haute",
        echeance: jour(maintenant, -2),
        prospectVendeurId: p1,
        creeLe: instant(maintenant, -6),
      },
      {
        id: IDS.taches[1],
        titre: "Vérifier la présence d'un ascenseur dans l'immeuble",
        contexte: "Information manquante — bloque un rapprochement acquéreur.",
        type: "appel",
        priorite: "normale",
        echeance: jour(maintenant, -1),
        bienId: b1,
        creeLe: instant(maintenant, -8),
      },
      {
        id: IDS.taches[2],
        titre: "Confirmer la date de l'acte avec l'étude notariale",
        contexte: "Compromis signé, acte prévu dans environ deux mois et demi.",
        type: "appel",
        priorite: "haute",
        echeance: jour(maintenant, 1),
        compromisId: c1,
        creeLe: instant(maintenant, -2),
      },
      {
        id: IDS.taches[3],
        titre: "Récupérer le diagnostic électricité",
        contexte: "Dossier documentaire incomplet avant diffusion large de l'annonce.",
        type: "document",
        priorite: "normale",
        echeance: jour(maintenant, 2),
        bienId: b1,
        creeLe: instant(maintenant, -5),
      },
      {
        id: IDS.taches[4],
        titre: "Proposer une seconde visite à Camille Ferrand",
        contexte: "Première visite programmée cette semaine.",
        type: "appel",
        priorite: "normale",
        echeance: jour(maintenant, 4),
        acquereurId: a1,
        creeLe: instant(maintenant, -2),
      },
      {
        id: IDS.taches[5],
        titre: "Mettre à jour les photos de l'annonce",
        contexte: null,
        type: "message",
        priorite: "basse",
        echeance: jour(maintenant, 9),
        bienId: b1,
        creeLe: instant(maintenant, -3),
      },
      {
        id: IDS.taches[6],
        titre: "Envoyer l'avis de valeur à Damien Roncier",
        contexte: "Estimation présentée lors du rendez-vous.",
        type: "email",
        priorite: "normale",
        echeance: jour(maintenant, -4),
        prospectVendeurId: p2,
        termineeLe: instant(maintenant, -4),
        creeLe: instant(maintenant, -23),
      },
    ],

    notesBien: [
      {
        id: IDS.notesBien[0],
        bienId: b1,
        contenu:
          "Le vendeur accepte les visites le samedi matin. Ascenseur : à confirmer auprès du syndic avant de répondre aux acquéreurs.",
        creeLe: instant(maintenant, -8),
      },
    ],

    notesProspect: [
      {
        id: IDS.notesProspect[0],
        prospectVendeurId: p1,
        type: "appel",
        contenu: "Point téléphonique : proposition de mandat envoyée, réponse attendue en fin de semaine.",
        creeLe: instant(maintenant, -6),
      },
    ],
  };
}

function verifierConfirmation(env) {
  if (env[NOM_VARIABLE_CONFIRMATION] !== VALEUR_CONFIRMATION_ATTENDUE) {
    throw new ErreurSeedDemo(
      "confirmation_manquante",
      `Seed refusé : confirmation explicite manquante. Relancer avec ${NOM_VARIABLE_CONFIRMATION}=${VALEUR_CONFIRMATION_ATTENDUE}.`
    );
  }
}

// Garde n°2. Deux questions distinctes par table : « reste-t-il des lignes qui ne sont pas à
// nous ? » (toute réponse > 0 est un refus sec) et « combien des nôtres sont déjà là ? » (tout,
// rien, ou un entre-deux qui impose l'arrêt).
async function inspecterBaseMetier(sql) {
  let totalConnues = 0;
  let totalAttendues = 0;
  const tablesInconnues = [];
  const tablesPartielles = [];

  for (const { table, ids } of TABLES_METIER) {
    const [{ total, connues }] = await sql`
      select
        count(*)::int as total,
        count(*) filter (where id::text = any(${ids}::text[]))::int as connues
      from ${sql(table)}
    `;
    const inconnues = total - connues;
    if (inconnues > 0) tablesInconnues.push({ table, inconnues });
    if (connues > 0 && connues < ids.length) tablesPartielles.push({ table, connues, attendues: ids.length });
    totalConnues += connues;
    totalAttendues += ids.length;
  }

  return { tablesInconnues, tablesPartielles, totalConnues, totalAttendues };
}

async function insererDataset(sql, dataset) {
  for (const p of dataset.prospects) {
    await sql`
      insert into prospects_vendeurs (
        id, nom, prenom, email, telephone, origine_lead, origine_lead_detail,
        adresse_bien_potentiel, secteur_bien_potentiel, ville, code_postal, type_bien,
        qualifie_le, estimation_proposee_centimes, estimation_proposee_le,
        rdv_estimation_prevu_le, rdv_estimation_realise_le, mandat_propose_le, mandat_signe_le,
        bien_id, motif_perte, date_perte, dernier_contact_le, cree_le, modifie_le
      ) values (
        ${p.id}, ${p.nom}, ${p.prenom}, ${p.email}, ${p.telephone}, ${p.origineLead}, ${p.origineLeadDetail},
        ${p.adresseBienPotentiel}, ${p.secteurBienPotentiel}, ${p.ville}, ${p.codePostal}, ${p.typeBien},
        ${p.qualifieLe}, ${p.estimationProposeeCentimes}, ${p.estimationProposeeLe},
        ${p.rdvEstimationPrevuLe}, ${p.rdvEstimationRealiseLe}, ${p.mandatProposeLe}, ${p.mandatSigneLe},
        ${p.bienId}, ${p.motifPerte}, ${p.datePerte}, ${p.dernierContactLe}, ${p.creeLe}, ${p.creeLe}
      )
    `;
  }

  for (const b of dataset.biens) {
    await sql`
      insert into biens (
        id, reference, titre, type, adresse, ville, code_postal, code_insee_commune,
        surface, pieces, prix, statut_mandat, date_mandat, caracteristiques, description,
        etage, ascenseur, parking, exterieur, charge_honoraires, nom_copropriete,
        offre_en_cours_le, compromis_signe_le, cree_le, modifie_le
      ) values (
        ${b.id}, ${b.reference}, ${b.titre}, ${b.type}, ${b.adresse}, ${b.ville}, ${b.codePostal}, ${b.codeInseeCommune},
        ${b.surface}, ${b.pieces}, ${b.prix}, ${b.statutMandat}, ${b.dateMandat}, ${b.caracteristiques}, ${b.description},
        ${b.etage}, ${b.ascenseur}, ${b.parking}, ${b.exterieur}, ${b.chargeHonoraires}, ${b.nomCopropriete},
        ${b.offreEnCoursLe}, ${b.compromisSigneLe}, ${b.creeLe}, ${b.creeLe}
      )
    `;
  }

  for (const a of dataset.acquereurs) {
    await sql`
      insert into acquereurs (
        id, prenom, nom, email, telephone, budget_min, budget_max, criteres, stade_projet, notes,
        date_premiere_contact, pieces_min, surface_min, accessibilite_requise,
        necessite_parking, necessite_exterieur, cree_le, modifie_le
      ) values (
        ${a.id}, ${a.prenom}, ${a.nom}, ${a.email}, ${a.telephone}, ${a.budgetMin}, ${a.budgetMax}, ${a.criteres}, ${a.stadeProjet}, ${a.notes},
        ${a.datePremiereContact}, ${a.piecesMin}, ${a.surfaceMin}, ${a.accessibiliteRequise},
        ${a.necessiteParking}, ${a.necessiteExterieur}, ${a.creeLe}, ${a.creeLe}
      )
    `;
    await sql`
      insert into secteurs_recherche_acquereur (id, acquereur_id, code_insee, nom_commune, code_postal, cree_le)
      values (${a.secteur.id}, ${a.id}, ${a.secteur.codeInsee}, ${a.secteur.nomCommune}, ${a.secteur.codePostal}, ${a.creeLe})
    `;
  }

  for (const v of dataset.visites) {
    await sql`
      insert into visites (id, bien_id, acquereur_id, date_prevue, statut, rendez_vous_calendar_id, cree_le)
      values (${v.id}, ${v.bienId}, ${v.acquereurId}, ${v.datePrevue}, ${v.statut}, ${v.rendezVousCalendarId}, ${v.creeLe})
    `;
  }

  for (const cr of dataset.comptesRendus) {
    await sql`
      insert into comptes_rendus_visite (id, bien_id, acquereur_id, visite_id, date_visite, retour, interet, prochaine_etape, cree_le)
      values (${cr.id}, ${cr.bienId}, ${cr.acquereurId}, ${cr.visiteId}, ${cr.dateVisite}, ${cr.retour}, ${cr.interet}, ${cr.prochaineEtape}, ${cr.creeLe})
    `;
  }

  for (const o of dataset.offres) {
    await sql`
      insert into offres (id, bien_id, acquereur_id, montant, date_offre, statut, date_validite, date_decision, motif_perte, cree_le)
      values (${o.id}, ${o.bienId}, ${o.acquereurId}, ${o.montant}, ${o.dateOffre}, ${o.statut}, ${o.dateValidite}, ${o.dateDecision}, ${o.motifPerte}, ${o.creeLe})
    `;
  }

  for (const l of dataset.offreVisites) {
    await sql`
      insert into offre_visites (id, offre_id, compte_rendu_visite_id, cree_le)
      values (${l.id}, ${l.offreId}, ${l.compteRenduVisiteId}, ${l.creeLe})
    `;
  }

  for (const c of dataset.compromis) {
    await sql`
      insert into compromis (
        id, bien_id, acquereur_id, offre_id, prix_convenu, date_signature, date_acte, date_acte_reelle,
        date_annulation, motif_annulation, statut, cree_le
      ) values (
        ${c.id}, ${c.bienId}, ${c.acquereurId}, ${c.offreId}, ${c.prixConvenu}, ${c.dateSignature}, ${c.dateActe}, ${c.dateActeReelle},
        ${c.dateAnnulation}, ${c.motifAnnulation}, ${c.statut}, ${c.creeLe}
      )
    `;
  }

  for (const r of dataset.remunerations) {
    await sql`
      insert into remuneration (
        id, compromis_id, montant_honoraires_total_centimes, montant_remuneration_conseiller_centimes,
        date_encaissement_prevue, date_encaissement_reelle, cree_le
      ) values (
        ${r.id}, ${r.compromisId}, ${r.montantHonorairesTotalCentimes}, ${r.montantRemunerationConseillerCentimes},
        ${r.dateEncaissementPrevue}, ${r.dateEncaissementReelle}, ${r.creeLe}
      )
    `;
  }

  for (const t of dataset.taches) {
    await sql`
      insert into taches (
        id, titre, contexte, type, priorite, echeance, origine, origine_code,
        bien_id, acquereur_id, prospect_vendeur_id, visite_id, offre_id, compromis_id, remuneration_id,
        cree_le, terminee_le, annulee_le
      ) values (
        ${t.id}, ${t.titre}, ${t.contexte ?? null}, ${t.type}, ${t.priorite}, ${t.echeance}, 'manuelle', null,
        ${t.bienId ?? null}, ${t.acquereurId ?? null}, ${t.prospectVendeurId ?? null}, null, null, ${t.compromisId ?? null}, null,
        ${t.creeLe}, ${t.termineeLe ?? null}, null
      )
    `;
  }

  for (const n of dataset.notesBien) {
    await sql`insert into notes_bien (id, bien_id, contenu, cree_le) values (${n.id}, ${n.bienId}, ${n.contenu}, ${n.creeLe})`;
  }

  for (const n of dataset.notesProspect) {
    await sql`
      insert into notes_prospect_vendeur (id, prospect_vendeur_id, type, contenu, cree_le)
      values (${n.id}, ${n.prospectVendeurId}, ${n.type}, ${n.contenu}, ${n.creeLe})
    `;
  }
}

// Point d'entrée unique — les deux gardes sont ici, sur le chemin d'écriture, jamais seulement
// dans la CLI : appeler cette fonction depuis un test ou un autre script ne contourne rien.
//
// `env` est typé explicitement plutôt que laissé inférer depuis `process.env` : sans cette
// annotation, un appelant TypeScript devrait fournir un ProcessEnv complet (NODE_ENV inclus) pour
// injecter une seule variable de confirmation.
/**
 * @param {import("postgres").Sql} sql
 * @param {{ env?: Record<string, string | undefined>, maintenant?: Date }} [options]
 */
export async function executerSeedDemo(sql, { env = process.env, maintenant = new Date() } = {}) {
  verifierConfirmation(env);

  const dataset = construireDataset(maintenant);

  return sql.begin(async (tx) => {
    const { tablesInconnues, tablesPartielles, totalConnues, totalAttendues } = await inspecterBaseMetier(tx);

    if (tablesInconnues.length > 0) {
      const detail = tablesInconnues.map((t) => `${t.table} (${t.inconnues})`).join(", ");
      throw new ErreurSeedDemo(
        "donnees_metier_inconnues",
        `Seed refusé : cette base contient déjà des données métier qui n'appartiennent pas au dataset de démonstration — ${detail}. Aucune écriture, aucune suppression.`
      );
    }

    if (tablesPartielles.length > 0 || (totalConnues > 0 && totalConnues < totalAttendues)) {
      throw new ErreurSeedDemo(
        "dataset_partiel",
        `Seed refusé : le dataset de démonstration est présent mais incomplet (${totalConnues}/${totalAttendues} lignes attendues). Aucune réparation automatique — recréer une base vierge.`
      );
    }

    if (totalConnues === totalAttendues) {
      return { statut: "deja_present", compteurs: compteurs(dataset) };
    }

    await insererDataset(tx, dataset);
    return { statut: "cree", compteurs: compteurs(dataset) };
  });
}

export function compteurs(dataset) {
  return {
    prospects: dataset.prospects.length,
    acquereurs: dataset.acquereurs.length,
    biens: dataset.biens.length,
    secteurs: dataset.acquereurs.length,
    visites: dataset.visites.length,
    comptesRendus: dataset.comptesRendus.length,
    offres: dataset.offres.length,
    compromis: dataset.compromis.length,
    remunerations: dataset.remunerations.length,
    taches: dataset.taches.length,
    notes: dataset.notesBien.length + dataset.notesProspect.length,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Seed refusé : DATABASE_URL n'est pas défini.");
    process.exit(1);
  }

  const sql = postgres(databaseUrl);
  try {
    const { statut, compteurs: c } = await executerSeedDemo(sql);

    console.log("DOMIORA — Seed de démonstration");
    if (statut === "deja_present") {
      console.log("Dataset de démonstration déjà présent.");
      return;
    }
    console.log(`${c.prospects} prospects vendeurs`);
    console.log(`${c.acquereurs} acquéreurs`);
    console.log(`${c.biens} biens seedés`);
    console.log(`${c.secteurs} secteurs de recherche`);
    console.log(`${c.visites} visites`);
    console.log(`${c.comptesRendus} compte rendu de visite`);
    console.log(`${c.offres} offre`);
    console.log(`${c.compromis} compromis`);
    console.log(`${c.remunerations} rémunération prévisionnelle`);
    console.log(`${c.taches} tâches`);
    console.log(`${c.notes} notes`);
    console.log("0 document, 0 photo — à charger manuellement via l'interface (voir README).");
    console.log("Seed terminé.");
  } finally {
    await sql.end();
  }
}

// Jamais exécuté à l'import (les tests importent ce module) — uniquement en invocation directe.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((erreur) => {
    console.error(erreur instanceof ErreurSeedDemo ? erreur.message : `Échec du seed : ${erreur.message}`);
    process.exit(1);
  });
}
