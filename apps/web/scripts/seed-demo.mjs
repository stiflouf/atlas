// Seed de démonstration DOMIORA (DEMO-02, refondu par DEMO_SEED_CANONICAL_V1) — script autonome,
// même patron que scripts/backfill-code-insee-commune.mjs (aucune dépendance aux alias "@/",
// exécutable hors Next.js). Destiné à une instance de DÉMONSTRATION dédiée, jamais à une base
// portant de vraies données.
//
// Usage :
//   DOMIORA_DEMO_SEED_CONFIRM=I_UNDERSTAND_THIS_IS_DEMO_DATA DATABASE_URL=... pnpm db:seed:demo
//
// Ce que ce seed raconte : « la journée d'un conseiller DOMIORA ». Quatre dossiers, tous sur le
// modèle CANONIQUE réellement lu par la V1 (Contacts, projets vendeur, mandats + parties `mandant`,
// Visites natives sans Calendar, bons de visite signés, retour vendeur en Interaction, offres,
// compromis, documents, photo) :
//   A. Houilles (Delcourt) — le dossier vivant : visite aujourd'hui, visite demain, visite passée
//      sans compte rendu, visite réalisée + CR + bon signé + retour vendeur, 3 documents, 1 photo.
//   B. Sartrouville (Aubry) — visite réalisée + CR, offre EN COURS, mandat à échéance proche.
//   C. Maisons-Laffitte (Reynal) — offre ACCEPTÉE, compromis en cours, rémunération prévisionnelle.
//   D. Pipeline vendeur : Vasseur (mandat proposé, à convertir EN DIRECT), Roncier (estimation
//      faite), Lantier (perdu).
//
// Pourquoi un script SQL direct plutôt que les Server Actions : celles-ci exigent toutes une
// session Atlas (ADR-047) — un seed n'a pas d'utilisateur. Les invariants applicatifs sont donc
// reproduits explicitement ici (jalons du bien, lien offre_visites, un seul compromis en_cours,
// un bon signé = document + hash SHA-256 réel + signature + fichiers réellement écrits).
//
// GARDES, toutes sur le chemin d'écriture (jamais seulement dans la CLI) :
//   1. confirmation explicite par variable d'environnement, jamais de valeur par défaut ;
//   2. exactement UN workspace en base (produit mono-conseiller, ADR-054) ;
//   3. refus si une seule ligne métier ÉTRANGÈRE au dataset existe — « étrangère » = ni un
//      identifiant déterministe du seed, ni une dépendance d'une entité du seed (voir
//      `calculerPerimetreSeed`) ;
//   4. REJOUABLE : si le dataset (complet ou partiel) est déjà là, le seed supprime UNIQUEMENT son
//      propre périmètre (entités déterministes + dépendances directes + fichiers seedés), puis
//      recrée tout — même état final à chaque exécution. Jamais de TRUNCATE, jamais de purge par
//      workspace.

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

export const NOM_VARIABLE_CONFIRMATION = "DOMIORA_DEMO_SEED_CONFIRM";
export const VALEUR_CONFIRMATION_ATTENDUE = "I_UNDERSTAND_THIS_IS_DEMO_DATA";

// Fuseau de l'application (src/lib/temps.ts, FUSEAU_HORAIRE_APP).
const FUSEAU_APP = "Europe/Paris";

// Même vocabulaire que src/lib/bonVisite/templateBonVisite.ts (VERSION_TEMPLATE_BON_VISITE_V1) —
// le snapshot fige le TEXTE réellement présenté, cette version dit quel gabarit l'a produit.
const VERSION_TEMPLATE_BON_VISITE = "domiora-v1";
const NOM_CONSEILLER_DEMO = "Conseiller DOMIORA";

export class ErreurSeedDemo extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ErreurSeedDemo";
    this.code = code;
  }
}

// UUID déterministes : ils sont à eux seuls le marqueur d'appartenance au dataset.
function uuidDemo(index) {
  return `d0d0d0d0-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// Clés de stockage déterministes (fichiers physiques) : préfixées, jamais un UUID aléatoire, donc
// localisables, recréables et supprimables — même arborescence que src/lib/stockageDocuments.ts et
// src/lib/stockagePhotosBien.ts (racine, photos/originaux, photos/optimisees/<cle>.webp).
function cleStockageDemo(nom) {
  return `demo-seed-${nom}`;
}

export const IDS = {
  contacts: {
    delcourt: uuidDemo(1001),
    reynal: uuidDemo(1002),
    aubry: uuidDemo(1003),
    vasseur: uuidDemo(1004),
    roncier: uuidDemo(1005),
    lantier: uuidDemo(1006),
    ferrand: uuidDemo(1007),
    delaunay: uuidDemo(1008),
    bassot: uuidDemo(1009),
    marchand: uuidDemo(1010),
    lemoine: uuidDemo(1011),
    nguyen: uuidDemo(1012),
  },
  projetsVendeur: [uuidDemo(1101), uuidDemo(1102), uuidDemo(1103), uuidDemo(1104), uuidDemo(1105), uuidDemo(1106)],
  partiesProjet: [uuidDemo(1201), uuidDemo(1202), uuidDemo(1203), uuidDemo(1204), uuidDemo(1205), uuidDemo(1206)],
  // 101-103 : pipeline vendeur (mandat proposé / estimation / perdu). 104-106 : convertis, un par bien.
  prospects: [uuidDemo(101), uuidDemo(102), uuidDemo(103), uuidDemo(104), uuidDemo(105), uuidDemo(106)],
  biens: [uuidDemo(301), uuidDemo(302), uuidDemo(303)],
  mandats: [uuidDemo(351), uuidDemo(352), uuidDemo(353)],
  partiesMandat: [uuidDemo(361), uuidDemo(362), uuidDemo(363)],
  acquereurs: [uuidDemo(201), uuidDemo(202), uuidDemo(203), uuidDemo(204), uuidDemo(205), uuidDemo(206)],
  secteurs: [uuidDemo(401), uuidDemo(402), uuidDemo(403), uuidDemo(404), uuidDemo(405), uuidDemo(406), uuidDemo(407), uuidDemo(408)],
  visites: {
    aujourdhui: uuidDemo(501),
    demain: uuidDemo(502),
    realiseeHouilles: uuidDemo(503),
    sansCompteRendu: uuidDemo(504),
    realiseeSartrouville: uuidDemo(505),
    realiseeMaisonsLaffitte: uuidDemo(506),
  },
  comptesRendus: [uuidDemo(601), uuidDemo(602), uuidDemo(603)],
  bonsVisite: [uuidDemo(651)],
  signaturesBonVisite: [uuidDemo(661)],
  offres: { enCours: uuidDemo(701), acceptee: uuidDemo(702) },
  offreVisites: [uuidDemo(801), uuidDemo(802)],
  compromis: [uuidDemo(901)],
  remunerations: [uuidDemo(1001)],
  documents: { bonSigne: uuidDemo(751), dpe: uuidDemo(752), mandat: uuidDemo(753) },
  photos: [uuidDemo(851)],
  interactions: [uuidDemo(1401), uuidDemo(1402), uuidDemo(1403)],
  taches: [uuidDemo(1501), uuidDemo(1502), uuidDemo(1503), uuidDemo(1504), uuidDemo(1505), uuidDemo(1506)],
  notesBien: [uuidDemo(1601)],
  notesProspect: [uuidDemo(1602)],
  evenements: [uuidDemo(1301), uuidDemo(1302), uuidDemo(1303)],
};

// Règles d'automatisation activées pour le workspace de démonstration, avec leur seuil (jours).
// `configurations_automatisation` a pour clé primaire le COUPLE (workspace_id, regle_code) depuis
// la migration 0054 (WORKSPACE_SCOPING_V2B5) : l'activation posée ici ne concerne QUE le workspace
// de démonstration, et ne peut plus, structurellement, écraser celle d'un autre. Ce seed n'écrit
// de toute façon que lorsqu'EXACTEMENT un workspace existe (garde n°2). Les valeurs par défaut du
// produit (règle inactive à la création) ne sont pas modifiées : seule cette base de démo reçoit
// ces lignes de configuration.
export const REGLES_DEMO = [
  { regleCode: "visite_j_1", seuilJours: 1 },
  { regleCode: "visite_sans_compte_rendu", seuilJours: 1 },
  { regleCode: "retour_vendeur_apres_visite", seuilJours: null },
  { regleCode: "offre_sans_decision", seuilJours: 3 },
  { regleCode: "offre_acceptee_sans_compromis", seuilJours: 5 },
  { regleCode: "mandat_expire_bientot", seuilJours: 30 },
  { regleCode: "nouveau_match_bien_acquereur", seuilJours: null },
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

function instant(base, jours, heures = 0) {
  const date = decaler(base, jours);
  date.setUTCHours(date.getUTCHours() + heures);
  return date;
}

function formatDateFr(dateCivileISO) {
  return new Date(`${dateCivileISO}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Texte du bon — même contenu que construireTexteBonVisite (templateBonVisite.ts), porté ici
// parce que ce script ne peut pas importer de module TypeScript.
function texteBonVisite(bien, datePrevue) {
  return [
    "Bon de visite",
    "",
    `Le bien "${bien.titre}" (réf. ${bien.reference}), situé ${bien.adresse}, ${bien.codePostal} ${bien.ville}, ` +
      `a été visité le ${formatDateFr(datePrevue)} en présence de ${NOM_CONSEILLER_DEMO}, représentant l'agence.`,
    "",
    "Ce document constitue une trace interne de la visite réalisée avec le concours de l'agence. " +
      "Il ne constitue ni un contrat, ni un avis juridique, et n'emporte aucune obligation d'achat ni de vente.",
  ].join("\n");
}

// Dataset complet et purement descriptif — aucune I/O, testable seul. `maintenant` est injecté :
// toutes les dates sont RELATIVES (J-9, demain, J+75…) pour que la démonstration reste vivante
// quel que soit le jour où le seed est rejoué.
export function construireDataset(maintenant) {
  const C = IDS.contacts;
  const [pj1, pj2, pj3, pj4, pj5, pj6] = IDS.projetsVendeur;
  const [pp1, pp2, pp3, pp4, pp5, pp6] = IDS.partiesProjet;
  const [p1, p2, p3, p4, p5, p6] = IDS.prospects;
  const [b1, b2, b3] = IDS.biens;
  const [m1, m2, m3] = IDS.mandats;
  const [a1, a2, a3, a4, a5, a6] = IDS.acquereurs;
  const V = IDS.visites;
  const [cr1, cr2, cr3] = IDS.comptesRendus;
  const [bon1] = IDS.bonsVisite;
  const [sig1] = IDS.signaturesBonVisite;
  const [c1] = IDS.compromis;
  const [r1] = IDS.remunerations;
  const D = IDS.documents;

  const contacts = [
    { id: C.delcourt, nom: "Delcourt", prenom: "Martine", email: "martine.delcourt@example.test", telephone: "0100000104", creeLe: instant(maintenant, -70) },
    { id: C.reynal, nom: "Reynal", prenom: "Olivier", email: "olivier.reynal@example.test", telephone: "0100000105", creeLe: instant(maintenant, -140) },
    { id: C.aubry, nom: "Aubry", prenom: "Claire", email: "claire.aubry@example.test", telephone: "0100000106", creeLe: instant(maintenant, -50) },
    { id: C.vasseur, nom: "Vasseur", prenom: "Hélène", email: "helene.vasseur@example.test", telephone: "0100000101", creeLe: instant(maintenant, -24) },
    { id: C.roncier, nom: "Roncier", prenom: "Damien", email: "damien.roncier@example.test", telephone: "0100000102", creeLe: instant(maintenant, -33) },
    { id: C.lantier, nom: "Lantier", prenom: "Sofia", email: "sofia.lantier@example.test", telephone: "0100000103", creeLe: instant(maintenant, -64) },
    { id: C.ferrand, nom: "Ferrand", prenom: "Camille", email: "camille.ferrand@example.test", telephone: "0100000001", creeLe: instant(maintenant, -38) },
    { id: C.delaunay, nom: "Delaunay", prenom: "Yanis", email: "yanis.delaunay@example.test", telephone: "0100000002", creeLe: instant(maintenant, -24) },
    { id: C.bassot, nom: "Bassot", prenom: "Noémie", email: "noemie.bassot@example.test", telephone: "0100000003", creeLe: instant(maintenant, -11) },
    { id: C.marchand, nom: "Marchand", prenom: "Théo", email: "theo.marchand@example.test", telephone: "0100000004", creeLe: instant(maintenant, -95) },
    { id: C.lemoine, nom: "Lemoine", prenom: "Inès", email: "ines.lemoine@example.test", telephone: "0100000005", creeLe: instant(maintenant, -20) },
    { id: C.nguyen, nom: "Nguyen", prenom: "Julien", email: "julien.nguyen@example.test", telephone: "0100000006", creeLe: instant(maintenant, -15) },
  ];

  // Un projet vendeur canonique par prospect (ADR-055), relié à son Contact par une partie `vendeur`
  // — exactement ce que creerProspectVendeurAction écrit.
  const projetsVendeur = [
    { id: pj1, contactId: C.vasseur, origineLead: "recommandation", origineLeadDetail: "Recommandée par un vendeur accompagné en 2025", mandatProposeLe: instant(maintenant, -6), mandatSigneLe: null, creeLe: instant(maintenant, -24) },
    { id: pj2, contactId: C.roncier, origineLead: "site_web", origineLeadDetail: "Formulaire d'estimation en ligne", mandatProposeLe: null, mandatSigneLe: null, creeLe: instant(maintenant, -33) },
    { id: pj3, contactId: C.lantier, origineLead: "prospection_terrain", origineLeadDetail: "Boîtage secteur gare", mandatProposeLe: instant(maintenant, -46), mandatSigneLe: null, motifPerte: "choix_agence_concurrente", datePerte: jour(maintenant, -35), creeLe: instant(maintenant, -64) },
    { id: pj4, contactId: C.delcourt, origineLead: "panneau", origineLeadDetail: "Panneau posé dans la rue voisine", mandatProposeLe: instant(maintenant, -50), mandatSigneLe: instant(maintenant, -45), creeLe: instant(maintenant, -70) },
    { id: pj5, contactId: C.reynal, origineLead: "ancien_client", origineLeadDetail: "Achat accompagné en 2019", mandatProposeLe: instant(maintenant, -125), mandatSigneLe: instant(maintenant, -120), creeLe: instant(maintenant, -140) },
    { id: pj6, contactId: C.aubry, origineLead: "reseaux_sociaux", origineLeadDetail: "Message reçu après une publication", mandatProposeLe: instant(maintenant, -34), mandatSigneLe: instant(maintenant, -30), creeLe: instant(maintenant, -50) },
  ];
  const partiesProjet = projetsVendeur.map((projet, index) => ({
    id: [pp1, pp2, pp3, pp4, pp5, pp6][index],
    contactId: projet.contactId,
    projetVendeurId: projet.id,
    role: "vendeur",
    creeLe: projet.creeLe,
  }));

  const prospects = [
    {
      id: p1, contactId: C.vasseur, projetVendeurId: pj1, nom: "Vasseur", prenom: "Hélène", email: "helene.vasseur@example.test", telephone: "0100000101",
      origineLead: "recommandation", origineLeadDetail: "Recommandée par un vendeur accompagné en 2025",
      adresseBienPotentiel: "8 rue du Clos Fictif", secteurBienPotentiel: "Sartrouville centre", ville: "Sartrouville", codePostal: "78500", typeBien: "maison",
      qualifieLe: instant(maintenant, -21), rdvEstimationPrevuLe: instant(maintenant, -16), rdvEstimationRealiseLe: instant(maintenant, -16),
      estimationProposeeCentimes: 62_500_000, estimationProposeeLe: jour(maintenant, -14), mandatProposeLe: instant(maintenant, -6), mandatSigneLe: null,
      bienId: null, motifPerte: null, datePerte: null, dernierContactLe: instant(maintenant, -6), creeLe: instant(maintenant, -24),
    },
    {
      id: p2, contactId: C.roncier, projetVendeurId: pj2, nom: "Roncier", prenom: "Damien", email: "damien.roncier@example.test", telephone: "0100000102",
      origineLead: "site_web", origineLeadDetail: "Formulaire d'estimation en ligne",
      adresseBienPotentiel: "22 avenue des Peupliers Fictive", secteurBienPotentiel: "Carrières-sur-Seine", ville: "Carrières-sur-Seine", codePostal: "78420", typeBien: "appartement",
      qualifieLe: instant(maintenant, -30), rdvEstimationPrevuLe: instant(maintenant, -25), rdvEstimationRealiseLe: instant(maintenant, -25),
      estimationProposeeCentimes: 31_800_000, estimationProposeeLe: jour(maintenant, -23), mandatProposeLe: null, mandatSigneLe: null,
      bienId: null, motifPerte: null, datePerte: null, dernierContactLe: instant(maintenant, -4), creeLe: instant(maintenant, -33),
    },
    {
      id: p3, contactId: C.lantier, projetVendeurId: pj3, nom: "Lantier", prenom: "Sofia", email: "sofia.lantier@example.test", telephone: "0100000103",
      origineLead: "prospection_terrain", origineLeadDetail: "Boîtage secteur gare",
      adresseBienPotentiel: "5 impasse des Vergers Fictive", secteurBienPotentiel: "Houilles", ville: "Houilles", codePostal: "78800", typeBien: "appartement",
      qualifieLe: instant(maintenant, -60), rdvEstimationPrevuLe: instant(maintenant, -52), rdvEstimationRealiseLe: instant(maintenant, -52),
      estimationProposeeCentimes: 29_500_000, estimationProposeeLe: jour(maintenant, -50), mandatProposeLe: instant(maintenant, -46), mandatSigneLe: null,
      bienId: null, motifPerte: "choix_agence_concurrente", datePerte: jour(maintenant, -35), dernierContactLe: instant(maintenant, -52), creeLe: instant(maintenant, -64),
    },
    {
      id: p4, contactId: C.delcourt, projetVendeurId: pj4, nom: "Delcourt", prenom: "Martine", email: "martine.delcourt@example.test", telephone: "0100000104",
      origineLead: "panneau", origineLeadDetail: "Panneau posé dans la rue voisine",
      adresseBienPotentiel: "14 rue des Tilleuls Fictifs", secteurBienPotentiel: "Houilles", ville: "Houilles", codePostal: "78800", typeBien: "appartement",
      qualifieLe: instant(maintenant, -66), rdvEstimationPrevuLe: instant(maintenant, -58), rdvEstimationRealiseLe: instant(maintenant, -58),
      estimationProposeeCentimes: 39_500_000, estimationProposeeLe: jour(maintenant, -56), mandatProposeLe: instant(maintenant, -50), mandatSigneLe: instant(maintenant, -45),
      bienId: b1, motifPerte: null, datePerte: null, dernierContactLe: instant(maintenant, -8), creeLe: instant(maintenant, -70),
    },
    {
      id: p5, contactId: C.reynal, projetVendeurId: pj5, nom: "Reynal", prenom: "Olivier", email: "olivier.reynal@example.test", telephone: "0100000105",
      origineLead: "ancien_client", origineLeadDetail: "Achat accompagné en 2019",
      adresseBienPotentiel: "3 allée des Charmes Fictive", secteurBienPotentiel: "Maisons-Laffitte", ville: "Maisons-Laffitte", codePostal: "78600", typeBien: "maison",
      qualifieLe: instant(maintenant, -136), rdvEstimationPrevuLe: instant(maintenant, -130), rdvEstimationRealiseLe: instant(maintenant, -130),
      estimationProposeeCentimes: 76_000_000, estimationProposeeLe: jour(maintenant, -128), mandatProposeLe: instant(maintenant, -125), mandatSigneLe: instant(maintenant, -120),
      bienId: b2, motifPerte: null, datePerte: null, dernierContactLe: instant(maintenant, -9), creeLe: instant(maintenant, -140),
    },
    {
      id: p6, contactId: C.aubry, projetVendeurId: pj6, nom: "Aubry", prenom: "Claire", email: "claire.aubry@example.test", telephone: "0100000106",
      origineLead: "reseaux_sociaux", origineLeadDetail: "Message reçu après une publication",
      adresseBienPotentiel: "27 rue de la Gare Fictive", secteurBienPotentiel: "Sartrouville", ville: "Sartrouville", codePostal: "78500", typeBien: "appartement",
      qualifieLe: instant(maintenant, -46), rdvEstimationPrevuLe: instant(maintenant, -40), rdvEstimationRealiseLe: instant(maintenant, -40),
      estimationProposeeCentimes: 32_000_000, estimationProposeeLe: jour(maintenant, -38), mandatProposeLe: instant(maintenant, -34), mandatSigneLe: instant(maintenant, -30),
      bienId: b3, motifPerte: null, datePerte: null, dernierContactLe: instant(maintenant, -3), creeLe: instant(maintenant, -50),
    },
  ];

  const biens = [
    {
      id: b1, reference: "DEMO-2026-001", titre: "Appartement 4 pièces avec balcon — proche gare", type: "appartement",
      adresse: "14 rue des Tilleuls Fictifs", ville: "Houilles", codePostal: "78800", codeInseeCommune: "78311",
      surface: 82, pieces: 4, prix: 389_000, statutMandat: "actif", dateMandat: jour(maintenant, -45),
      caracteristiques: ["Double exposition est-ouest", "Cuisine ouverte équipée", "Balcon de 6 m²", "Cave", "Place de parking en sous-sol", "Charges 180 €/mois"],
      description: "Quatre pièces traversant au deuxième étage d'une petite copropriété, à sept minutes à pied de la gare.",
      // Volontairement INCONNU (NULL), jamais false : c'est ce qui fait ressortir un acquéreur
      // "à vérifier" plutôt qu'"incompatible" (ADR-009, inconnu != non).
      etage: 2, ascenseur: null, parking: true, exterieur: "balcon", chargeHonoraires: "vendeur", nomCopropriete: "Résidence des Tilleuls",
      offreEnCoursLe: null, compromisSigneLe: null, creeLe: instant(maintenant, -45),
    },
    {
      id: b2, reference: "DEMO-2026-002", titre: "Maison familiale 5 pièces avec jardin", type: "maison",
      adresse: "3 allée des Charmes Fictive", ville: "Maisons-Laffitte", codePostal: "78600", codeInseeCommune: "78358",
      surface: 128, pieces: 5, prix: 745_000, statutMandat: "actif", dateMandat: jour(maintenant, -120),
      caracteristiques: ["Jardin clos de 320 m²", "Garage double", "Cuisine indépendante", "Combles aménageables", "Chaudière remplacée en 2023"],
      description: "Maison familiale sur trois niveaux, jardin clos sans vis-à-vis, à proximité des écoles.",
      etage: null, ascenseur: null, parking: true, exterieur: "jardin", chargeHonoraires: "acquereur", nomCopropriete: null,
      // Jalons posés exactement comme le feraient ajouterOffreAction et ajouterCompromisAction (ADR-014).
      offreEnCoursLe: instant(maintenant, -10), compromisSigneLe: instant(maintenant, -2), creeLe: instant(maintenant, -120),
    },
    {
      id: b3, reference: "DEMO-2026-003", titre: "Appartement 3 pièces lumineux — dernier étage", type: "appartement",
      adresse: "27 rue de la Gare Fictive", ville: "Sartrouville", codePostal: "78500", codeInseeCommune: "78586",
      surface: 64, pieces: 3, prix: 315_000, statutMandat: "actif", dateMandat: jour(maintenant, -30),
      caracteristiques: ["Dernier étage avec ascenseur", "Vue dégagée", "Cuisine aménagée", "Cave", "Charges 140 €/mois"],
      description: "Trois pièces au dernier étage d'une résidence entretenue, à cinq minutes de la gare RER.",
      etage: 4, ascenseur: true, parking: false, exterieur: null, chargeHonoraires: "vendeur", nomCopropriete: "Résidence de la Gare",
      offreEnCoursLe: instant(maintenant, -3), compromisSigneLe: null, creeLe: instant(maintenant, -30),
    },
  ];

  // Mandats canoniques (ADR-060) : un par bien, rattachés au projet vendeur, avec la partie
  // `mandant` = le Contact vendeur — exactement ce que signerMandatProspectVendeur écrit désormais
  // (VISIT_NATIVE_ENTRY_V1). Le mandat de Sartrouville arrive à échéance dans 20 jours (règle
  // `mandat_expire_bientot`, seuil 30).
  const mandats = [
    { id: m1, bienId: b1, projetVendeurId: pj4, type: "exclusif", numero: "M-2026-014", dateDebut: jour(maintenant, -45), dateFin: jour(maintenant, 135), exclusiviteJusquAu: jour(maintenant, 45), creeLe: instant(maintenant, -45) },
    { id: m2, bienId: b2, projetVendeurId: pj5, type: "simple", numero: "M-2026-003", dateDebut: jour(maintenant, -120), dateFin: jour(maintenant, 245), exclusiviteJusquAu: null, creeLe: instant(maintenant, -120) },
    { id: m3, bienId: b3, projetVendeurId: pj6, type: "simple", numero: "M-2026-021", dateDebut: jour(maintenant, -30), dateFin: jour(maintenant, 20), exclusiviteJusquAu: null, creeLe: instant(maintenant, -30) },
  ];
  const partiesMandat = [
    { id: IDS.partiesMandat[0], mandatId: m1, contactId: C.delcourt, role: "mandant", creeLe: instant(maintenant, -45) },
    { id: IDS.partiesMandat[1], mandatId: m2, contactId: C.reynal, role: "mandant", creeLe: instant(maintenant, -120) },
    { id: IDS.partiesMandat[2], mandatId: m3, contactId: C.aubry, role: "mandant", creeLe: instant(maintenant, -30) },
  ];

  // Six acquéreurs, chacun rattaché à son Contact, construits pour que le moteur de compatibilité
  // (ADR-034/035, fonction pure evaluerCompatibilite) produise LUI-MÊME compatible / à vérifier /
  // incompatible sur le bien pivot (Houilles). Les états attendus sont listés plus bas
  // (`compatibilitesAttendues`) et vérifiés contre le vrai moteur par le test.
  const acquereurs = [
    {
      id: a1, contactId: C.ferrand, prenom: "Camille", nom: "Ferrand", email: "camille.ferrand@example.test", telephone: "0100000001",
      budgetMin: 320_000, budgetMax: 420_000, criteres: ["Proximité gare", "Balcon ou terrasse", "Stationnement"], stadeProjet: "recherche_active",
      notes: "Prêt bancaire accordé, disponible pour visiter en semaine.", datePremiereContact: jour(maintenant, -38),
      piecesMin: 3, surfaceMin: 70, accessibiliteRequise: null, necessiteParking: true, necessiteExterieur: true, creeLe: instant(maintenant, -38),
      secteurs: [{ id: IDS.secteurs[0], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" }],
    },
    {
      id: a2, contactId: C.delaunay, prenom: "Yanis", nom: "Delaunay", email: "yanis.delaunay@example.test", telephone: "0100000002",
      budgetMin: 300_000, budgetMax: 400_000, criteres: ["Étage accessible", "Proche transports"], stadeProjet: "recherche_active",
      notes: "Recherche un logement réellement accessible — l'ascenseur est une condition.", datePremiereContact: jour(maintenant, -24),
      // Seul critère qui bascule le couple avec le bien pivot en "à vérifier" : l'ascenseur est inconnu.
      piecesMin: 3, surfaceMin: 75, accessibiliteRequise: true, necessiteParking: null, necessiteExterieur: null, creeLe: instant(maintenant, -24),
      secteurs: [{ id: IDS.secteurs[1], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" }],
    },
    {
      id: a3, contactId: C.bassot, prenom: "Noémie", nom: "Bassot", email: "noemie.bassot@example.test", telephone: "0100000003",
      budgetMin: 180_000, budgetMax: 250_000, criteres: ["Premier achat", "Budget serré"], stadeProjet: "decouverte",
      notes: "Premier achat, financement en cours de montage.", datePremiereContact: jour(maintenant, -11),
      piecesMin: 2, surfaceMin: 45, accessibiliteRequise: null, necessiteParking: null, necessiteExterieur: null, creeLe: instant(maintenant, -11),
      secteurs: [{ id: IDS.secteurs[2], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" }],
    },
    {
      id: a4, contactId: C.marchand, prenom: "Théo", nom: "Marchand", email: "theo.marchand@example.test", telephone: "0100000004",
      budgetMin: 650_000, budgetMax: 780_000, criteres: ["Maison familiale", "Jardin", "Proche écoles"], stadeProjet: "compromis",
      notes: "Compromis signé sur la maison de Maisons-Laffitte.", datePremiereContact: jour(maintenant, -95),
      piecesMin: 4, surfaceMin: 110, accessibiliteRequise: null, necessiteParking: null, necessiteExterieur: true, creeLe: instant(maintenant, -95),
      secteurs: [{ id: IDS.secteurs[3], codeInsee: "78358", nomCommune: "Maisons-Laffitte", codePostal: "78600" }],
    },
    {
      id: a5, contactId: C.lemoine, prenom: "Inès", nom: "Lemoine", email: "ines.lemoine@example.test", telephone: "0100000005",
      budgetMin: 290_000, budgetMax: 400_000, criteres: ["Proche RER", "Lumineux"], stadeProjet: "offre",
      notes: "A fait une offre sur le trois pièces de Sartrouville, visite prévue demain à Houilles pour comparer.", datePremiereContact: jour(maintenant, -20),
      piecesMin: 3, surfaceMin: 60, accessibiliteRequise: null, necessiteParking: null, necessiteExterieur: null, creeLe: instant(maintenant, -20),
      secteurs: [
        { id: IDS.secteurs[4], codeInsee: "78586", nomCommune: "Sartrouville", codePostal: "78500" },
        { id: IDS.secteurs[5], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" },
      ],
    },
    {
      id: a6, contactId: C.nguyen, prenom: "Julien", nom: "Nguyen", email: "julien.nguyen@example.test", telephone: "0100000006",
      budgetMin: 300_000, budgetMax: 410_000, criteres: ["Lumineux", "Calme"], stadeProjet: "recherche_active",
      notes: "A visité Houilles la semaine dernière, retour à formaliser. Ouvert à Sartrouville.", datePremiereContact: jour(maintenant, -15),
      piecesMin: 3, surfaceMin: 60, accessibiliteRequise: null, necessiteParking: null, necessiteExterieur: null, creeLe: instant(maintenant, -15),
      secteurs: [
        { id: IDS.secteurs[6], codeInsee: "78311", nomCommune: "Houilles", codePostal: "78800" },
        { id: IDS.secteurs[7], codeInsee: "78586", nomCommune: "Sartrouville", codePostal: "78500" },
      ],
    },
  ];

  // Visites 100 % NATIVES (rendez_vous_calendar_id NULL, ADR-063) : aucune dépendance Google
  // Calendar, aucun faux identifiant de rendez-vous. `realisee_le` posé pour toute visite réalisée.
  const visites = [
    { id: V.aujourdhui, bienId: b1, acquereurId: a1, datePrevue: jour(maintenant, 0), statut: "planifiee", realiseeLe: null, creeLe: instant(maintenant, -3) },
    { id: V.demain, bienId: b1, acquereurId: a5, datePrevue: jour(maintenant, 1), statut: "planifiee", realiseeLe: null, creeLe: instant(maintenant, -2) },
    { id: V.realiseeHouilles, bienId: b1, acquereurId: a2, datePrevue: jour(maintenant, -9), statut: "realisee", realiseeLe: instant(maintenant, -9, 11), creeLe: instant(maintenant, -12) },
    // Passée sans compte rendu : reste `planifiee` (invariant : un CR fait toujours transiter la
    // visite vers `realisee`), au-delà du seuil de `visite_sans_compte_rendu`.
    { id: V.sansCompteRendu, bienId: b1, acquereurId: a6, datePrevue: jour(maintenant, -6), statut: "planifiee", realiseeLe: null, creeLe: instant(maintenant, -10) },
    { id: V.realiseeSartrouville, bienId: b3, acquereurId: a5, datePrevue: jour(maintenant, -5), statut: "realisee", realiseeLe: instant(maintenant, -5, 10), creeLe: instant(maintenant, -8) },
    { id: V.realiseeMaisonsLaffitte, bienId: b2, acquereurId: a4, datePrevue: jour(maintenant, -14), statut: "realisee", realiseeLe: instant(maintenant, -14, 15), creeLe: instant(maintenant, -18) },
  ];

  const comptesRendus = [
    { id: cr1, bienId: b1, acquereurId: a2, visiteId: V.realiseeHouilles, dateVisite: jour(maintenant, -9), retour: "Très bonne impression générale, luminosité appréciée. Point d'attention : l'accès à l'étage (ascenseur à confirmer avec le syndic).", interet: "a_reflechir", prochaineEtape: "Confirmer la présence d'un ascenseur, puis proposer une seconde visite.", creeLe: instant(maintenant, -9, 12) },
    { id: cr2, bienId: b3, acquereurId: a5, visiteId: V.realiseeSartrouville, dateVisite: jour(maintenant, -5), retour: "Coup de cœur pour la vue et la luminosité. Souhaite faire une offre rapidement.", interet: "interesse", prochaineEtape: "Réceptionner l'offre écrite.", creeLe: instant(maintenant, -5, 11) },
    { id: cr3, bienId: b2, acquereurId: a4, visiteId: V.realiseeMaisonsLaffitte, dateVisite: jour(maintenant, -14), retour: "Maison conforme aux attentes, jardin et écoles à proximité décisifs. Offre annoncée sous une semaine.", interet: "interesse", prochaineEtape: "Préparer la négociation.", creeLe: instant(maintenant, -14, 16) },
  ];

  // Bon de visite SIGNÉ sur la visite réalisée de Houilles : brouillon créé le jour de la visite,
  // signé sur place (signature tactile DOMIORA), document PDF final + hash SHA-256 réels (voir
  // insererDataset : le PDF et l'image de signature sont réellement générés et écrits).
  const signeLe = instant(maintenant, -9, 12);
  const bonsVisite = [
    {
      id: bon1, visiteId: V.realiseeHouilles, version: 1, statut: "signe", templateVersion: VERSION_TEMPLATE_BON_VISITE,
      contenuSnapshot: {
        visite: { id: V.realiseeHouilles, datePrevue: jour(maintenant, -9) },
        bien: { id: b1, reference: biens[0].reference, titre: biens[0].titre, adresse: biens[0].adresse, ville: biens[0].ville, codePostal: biens[0].codePostal },
        conseiller: { nom: NOM_CONSEILLER_DEMO },
        template: { version: VERSION_TEMPLATE_BON_VISITE, texte: texteBonVisite(biens[0], jour(maintenant, -9)) },
      },
      documentId: D.bonSigne, creeLe: instant(maintenant, -9, 11), signeLe,
      signature: { id: sig1, contactId: C.delaunay, roleSignataire: "principal", nomSnapshot: "Delaunay", prenomSnapshot: "Yanis", emailSnapshot: "yanis.delaunay@example.test", signatureCleStockage: cleStockageDemo("signature-661") },
    },
  ];

  // Documents : le bon signé (rattaché à la visite), un DPE et le mandat scanné — tous avec un
  // fichier PDF réellement écrit (voir insererDataset), jamais une métadonnée orpheline.
  const documents = [
    {
      id: D.bonSigne, bienId: b1, visiteId: V.realiseeHouilles, nom: `Bon de visite signé — ${biens[0].reference}`, categorie: "commercial", typeDocument: "bon_visite",
      nomFichierOriginal: `bon-visite-${biens[0].reference}-${jour(maintenant, -9)}.pdf`, cleStockage: cleStockageDemo("document-751"),
      typeMime: "application/pdf", dateDocument: jour(maintenant, -9), dateFinValidite: null, provenance: null, etatVerification: "non_verifie", creeLe: signeLe,
      contenu: "bon_visite",
    },
    {
      id: D.dpe, bienId: b1, visiteId: null, nom: "Diagnostic de performance énergétique", categorie: "diagnostic", typeDocument: "dpe",
      nomFichierOriginal: "dpe-14-rue-des-tilleuls.pdf", cleStockage: cleStockageDemo("document-752"),
      typeMime: "application/pdf", dateDocument: jour(maintenant, -40), dateFinValidite: jour(maintenant, 3610), provenance: "Diagnostiqueur mandaté par le vendeur", etatVerification: "confirme", creeLe: instant(maintenant, -40),
      contenu: { titre: "Diagnostic de performance énergétique", lignes: ["Bien : 14 rue des Tilleuls Fictifs, 78800 Houilles", "Classe énergie : D — Classe climat : C", "Document de démonstration, sans valeur réglementaire."] },
    },
    {
      id: D.mandat, bienId: b1, visiteId: null, nom: "Mandat exclusif de vente — M-2026-014", categorie: "mandat", typeDocument: "mandat",
      nomFichierOriginal: "mandat-exclusif-M-2026-014.pdf", cleStockage: cleStockageDemo("document-753"),
      typeMime: "application/pdf", dateDocument: jour(maintenant, -45), dateFinValidite: jour(maintenant, 135), provenance: "Signé en agence", etatVerification: "confirme", creeLe: instant(maintenant, -45),
      contenu: { titre: "Mandat exclusif de vente", lignes: ["Mandant : Martine Delcourt", "Bien : 14 rue des Tilleuls Fictifs, 78800 Houilles", "Durée : 6 mois — Document de démonstration, sans valeur juridique."] },
    },
  ];

  const photos = [
    { id: IDS.photos[0], bienId: b1, cleStockage: cleStockageDemo("photo-851"), nomFichierOriginal: "sejour-tilleuls.jpg", typeMimeOriginal: "image/jpeg", ordre: 0, creeLe: instant(maintenant, -44) },
  ];

  // Retour vendeur (Interaction canonique, ADR-063) sur la visite réalisée de Houilles, vers le
  // mandant réel ; plus un appel entrant et un email sortant pour faire vivre les fiches Contact.
  const interactions = [
    { id: IDS.interactions[0], contactId: C.delcourt, type: "appel", sens: "sortant", survenuLe: instant(maintenant, -8, 9), contenu: "Retour fait à Mme Delcourt : visiteur intéressé mais attend confirmation sur l'ascenseur. Rassurée, elle relance le syndic.", visiteId: V.realiseeHouilles, bienId: null, natureMetier: "retour_vendeur_post_visite", creeLe: instant(maintenant, -8, 9) },
    { id: IDS.interactions[1], contactId: C.ferrand, type: "appel", sens: "entrant", survenuLe: instant(maintenant, -3, 10), contenu: "Appel de Camille Ferrand : confirme sa disponibilité pour visiter Houilles, prêt accordé.", visiteId: null, bienId: b1, natureMetier: null, creeLe: instant(maintenant, -3, 10) },
    { id: IDS.interactions[2], contactId: C.marchand, type: "email", sens: "sortant", survenuLe: instant(maintenant, -9, 17), contenu: "Envoi de la trame de compromis et des diagnostics à Théo Marchand avant rendez-vous chez le notaire.", visiteId: null, bienId: b2, natureMetier: null, creeLe: instant(maintenant, -9, 17) },
  ];

  // Offres : une EN COURS (Sartrouville, Lemoine, J-3 — candidate `offre_sans_decision`, seuil 3) et
  // une ACCEPTÉE (Maisons-Laffitte, Marchand) — au plus une acceptée active par bien, compromis
  // uniquement sur l'acceptée.
  const offres = [
    { id: IDS.offres.enCours, bienId: b3, acquereurId: a5, montant: 300_000, dateOffre: jour(maintenant, -3), statut: "en_cours", dateValidite: jour(maintenant, 7), dateDecision: null, motifPerte: null, creeLe: instant(maintenant, -3, 18) },
    { id: IDS.offres.acceptee, bienId: b2, acquereurId: a4, montant: 730_000, dateOffre: jour(maintenant, -10), statut: "acceptee", dateValidite: jour(maintenant, 0), dateDecision: jour(maintenant, -8), motifPerte: null, creeLe: instant(maintenant, -10, 9) },
  ];
  // dateVisite <= dateOffre, même bien et même acquéreur des deux côtés (ADR-019).
  const offreVisites = [
    { id: IDS.offreVisites[0], offreId: IDS.offres.enCours, compteRenduVisiteId: cr2, creeLe: instant(maintenant, -3, 18) },
    { id: IDS.offreVisites[1], offreId: IDS.offres.acceptee, compteRenduVisiteId: cr3, creeLe: instant(maintenant, -10, 9) },
  ];

  const compromis = [
    { id: c1, bienId: b2, acquereurId: a4, offreId: IDS.offres.acceptee, prixConvenu: 730_000, dateSignature: jour(maintenant, -2), dateActe: jour(maintenant, 75), dateActeReelle: null, dateAnnulation: null, motifAnnulation: null, statut: "en_cours", creeLe: instant(maintenant, -2, 14) },
  ];
  // Honoraires 3 % du prix convenu, part conseiller 70 % — montants en centimes entiers.
  const remunerations = [
    { id: r1, compromisId: c1, montantHonorairesTotalCentimes: 2_190_000, montantRemunerationConseillerCentimes: 1_533_000, dateEncaissementPrevue: jour(maintenant, 75), dateEncaissementReelle: null, creeLe: instant(maintenant, -2, 14) },
  ];

  // Tâches manuelles : une en retard, une aujourd'hui, deux à venir, une terminée — assez pour
  // qu'Aujourd'hui vive, pas assez pour le noyer (les tâches automatiques viennent des règles).
  const taches = [
    { id: IDS.taches[0], titre: "Relancer Hélène Vasseur sur la proposition de mandat", contexte: "Mandat proposé il y a 6 jours, sans réponse.", type: "relance", priorite: "haute", echeance: jour(maintenant, -2), prospectVendeurId: p1, creeLe: instant(maintenant, -6) },
    { id: IDS.taches[1], titre: "Confirmer l'heure de la visite de demain avec Inès Lemoine", contexte: "Visite planifiée demain à Houilles.", type: "appel", priorite: "haute", echeance: jour(maintenant, 0), bienId: b1, creeLe: instant(maintenant, -2) },
    { id: IDS.taches[2], titre: "Confirmer la date de l'acte avec l'étude notariale", contexte: "Acte prévu dans 75 jours.", type: "appel", priorite: "normale", echeance: jour(maintenant, 2), compromisId: c1, creeLe: instant(maintenant, -2) },
    { id: IDS.taches[3], titre: "Récupérer le diagnostic électricité", contexte: "Manque au dossier documentaire de Sartrouville.", type: "document", priorite: "normale", echeance: jour(maintenant, 4), bienId: b3, creeLe: instant(maintenant, -5) },
    { id: IDS.taches[4], titre: "Envoyer l'avis de valeur à Damien Roncier", contexte: null, type: "email", priorite: "normale", echeance: jour(maintenant, -4), prospectVendeurId: p2, creeLe: instant(maintenant, -12), termineeLe: instant(maintenant, -5) },
    { id: IDS.taches[5], titre: "Proposer une seconde visite à Noémie Bassot sur un bien dans son budget", contexte: null, type: "appel", priorite: "basse", echeance: jour(maintenant, 9), acquereurId: a3, creeLe: instant(maintenant, -1) },
  ];

  const notesBien = [
    { id: IDS.notesBien[0], bienId: b1, contenu: "Le syndic doit confirmer l'existence de l'ascenseur (immeuble de 1972, cage d'escalier étroite) — réponse attendue cette semaine.", creeLe: instant(maintenant, -7) },
  ];
  const notesProspect = [
    { id: IDS.notesProspect[0], prospectVendeurId: p1, type: "appel", contenu: "Point téléphonique : proposition de mandat envoyée, réponse attendue en fin de semaine.", creeLe: instant(maintenant, -6) },
  ];

  // Exactement ce qu'émet signerMandatProspectVendeur : un événement 'mandat_signe' par conversion.
  const evenements = [
    { id: IDS.evenements[0], typeEvenement: "mandat_signe", prospectVendeurId: p4, survenuLe: instant(maintenant, -45) },
    { id: IDS.evenements[1], typeEvenement: "mandat_signe", prospectVendeurId: p5, survenuLe: instant(maintenant, -120) },
    { id: IDS.evenements[2], typeEvenement: "mandat_signe", prospectVendeurId: p6, survenuLe: instant(maintenant, -30) },
  ];

  // États de compatibilité (ADR-036) pour TOUTES les paires bien × acquéreur, tels que le vrai
  // moteur les calcule sur ces données — jamais un score, uniquement le dernier statut observé. Le
  // test compare chaque paire au moteur : toute divergence est une donnée du seed à corriger,
  // jamais le moteur. Un scan de compatibilité ultérieur ne produit donc aucune transition fantôme.
  const compatibilitesAttendues = [
    { bienId: b1, acquereurId: a1, statut: "compatible" },
    { bienId: b1, acquereurId: a2, statut: "a_verifier" },
    { bienId: b1, acquereurId: a3, statut: "incompatible" },
    { bienId: b1, acquereurId: a4, statut: "incompatible" },
    { bienId: b1, acquereurId: a5, statut: "compatible" },
    { bienId: b1, acquereurId: a6, statut: "compatible" },
    { bienId: b2, acquereurId: a1, statut: "incompatible" },
    { bienId: b2, acquereurId: a2, statut: "incompatible" },
    { bienId: b2, acquereurId: a3, statut: "incompatible" },
    { bienId: b2, acquereurId: a4, statut: "compatible" },
    { bienId: b2, acquereurId: a5, statut: "incompatible" },
    { bienId: b2, acquereurId: a6, statut: "incompatible" },
    { bienId: b3, acquereurId: a1, statut: "incompatible" },
    { bienId: b3, acquereurId: a2, statut: "incompatible" },
    { bienId: b3, acquereurId: a3, statut: "incompatible" },
    { bienId: b3, acquereurId: a4, statut: "incompatible" },
    { bienId: b3, acquereurId: a5, statut: "compatible" },
    { bienId: b3, acquereurId: a6, statut: "compatible" },
  ];

  return {
    contacts, projetsVendeur, partiesProjet, prospects, biens, mandats, partiesMandat, acquereurs,
    visites, comptesRendus, bonsVisite, documents, photos, interactions, offres, offreVisites,
    compromis, remunerations, taches, notesBien, notesProspect, evenements, compatibilitesAttendues,
    reglesDemo: REGLES_DEMO,
  };
}

// ───────────────────────────── FICHIERS (PDF, PNG, JPEG/WebP) ─────────────────────────────

// Même résolution que src/lib/stockageDocuments.ts::resoudreRepertoireStockageDocuments — ce
// script ne peut pas l'importer (TypeScript), la règle est portée ici à l'identique.
export function resoudreRepertoireStockage(env = process.env) {
  const configure = env.ATLAS_DOCUMENT_STORAGE_DIR;
  if (env.NODE_ENV === "production") {
    if (!configure || !path.isAbsolute(configure)) {
      throw new ErreurSeedDemo("stockage_non_configure", "ATLAS_DOCUMENT_STORAGE_DIR doit être un chemin absolu en production.");
    }
    return configure;
  }
  return configure && configure.length > 0 ? configure : path.join(process.cwd(), "stockage-documents");
}

export function cheminsFichiersSeed(racine) {
  return {
    document: (cle) => path.join(racine, cle),
    signature: (cle) => path.join(racine, cle),
    photoOriginale: (cle) => path.join(racine, "photos", "originaux", cle),
    photoOptimisee: (cle) => path.join(racine, "photos", "optimisees", `${cle}.webp`),
  };
}

async function genererPngSignature() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160" viewBox="0 0 400 160">
    <path d="M20 110 C 60 20, 90 150, 130 80 S 200 30, 230 100 S 300 60, 380 90" fill="none" stroke="#1c2a44" stroke-width="4" stroke-linecap="round"/>
    <path d="M40 125 C 120 118, 220 130, 360 120" fill="none" stroke="#1c2a44" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Même mise en page que src/lib/bonVisite/pdfBonVisite.ts (A4, Helvetica, texte du snapshot,
// signataire, image de signature, horodatage) — reproduite ici pour les mêmes raisons d'import.
async function genererPdfBonSigne(bon, signaturePng) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const marge = 56;
  let y = 841.89 - marge;
  const noir = rgb(0.11, 0.11, 0.11);
  const gris = rgb(0.4, 0.4, 0.4);
  const ecrire = (texte, opts = {}) => {
    const taille = opts.taille ?? 11;
    page.drawText(texte, { x: marge, y, size: taille, font: opts.police ?? font, color: opts.couleur ?? noir });
    y -= taille * 1.4 + (opts.espaceApres ?? 0);
  };
  ecrire("BON DE VISITE", { taille: 18, police: fontBold, espaceApres: 10 });
  for (const paragraphe of bon.contenuSnapshot.template.texte.split("\n")) {
    if (paragraphe === "") {
      ecrire(" ");
      continue;
    }
    let ligne = "";
    for (const mot of paragraphe.split(" ")) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (font.widthOfTextAtSize(essai, 11) > 595.28 - marge * 2 && ligne) {
        ecrire(ligne);
        ligne = mot;
      } else {
        ligne = essai;
      }
    }
    ecrire(ligne);
  }
  y -= 16;
  ecrire("Signataire", { taille: 12, police: fontBold, espaceApres: 2 });
  ecrire(`${bon.signature.prenomSnapshot} ${bon.signature.nomSnapshot} (${bon.signature.roleSignataire})`);
  y -= 24;
  const image = await pdf.embedPng(new Uint8Array(signaturePng));
  const largeur = 200;
  const hauteur = image.height * (largeur / image.width);
  page.drawImage(image, { x: marge, y: y - hauteur, width: largeur, height: hauteur });
  y -= hauteur + 8;
  page.drawLine({ start: { x: marge, y }, end: { x: marge + largeur, y }, thickness: 0.5, color: gris });
  y -= 14;
  const horodatage = bon.signeLe.toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: FUSEAU_APP });
  ecrire(`Signé le ${horodatage}`, { taille: 9, couleur: gris });
  return Buffer.from(await pdf.save());
}

async function genererPdfSimple(contenu) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 841.89 - 56;
  page.drawText(contenu.titre, { x: 56, y, size: 18, font: fontBold, color: rgb(0.11, 0.11, 0.11) });
  y -= 36;
  for (const ligne of contenu.lignes) {
    page.drawText(ligne, { x: 56, y, size: 11, font, color: rgb(0.11, 0.11, 0.11) });
    y -= 18;
  }
  return Buffer.from(await pdf.save());
}

// Photo de démonstration : une illustration vectorielle sobre rendue en JPEG (original) et en WebP
// (optimisée, même paramètres que traitementPhotoBien.ts : côté max 1600, qualité 82). Purement
// fictive, aucune image réelle.
async function genererPhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
    <defs>
      <linearGradient id="ciel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbe7f3"/><stop offset="1" stop-color="#f4efe6"/></linearGradient>
      <linearGradient id="sol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9cbb5"/><stop offset="1" stop-color="#b9a68a"/></linearGradient>
    </defs>
    <rect width="1600" height="1067" fill="url(#ciel)"/>
    <rect y="760" width="1600" height="307" fill="url(#sol)"/>
    <rect x="180" y="220" width="1240" height="560" fill="#f7f3ec" stroke="#8b7b66" stroke-width="6"/>
    <rect x="180" y="220" width="1240" height="40" fill="#e3d5c1"/>
    <g fill="#9fc3df" stroke="#5f6f80" stroke-width="5">
      <rect x="260" y="320" width="220" height="180"/><rect x="560" y="320" width="220" height="180"/>
      <rect x="860" y="320" width="220" height="180"/><rect x="1160" y="320" width="180" height="180"/>
      <rect x="260" y="560" width="220" height="200"/><rect x="860" y="560" width="220" height="200"/><rect x="1160" y="560" width="180" height="200"/>
    </g>
    <rect x="560" y="560" width="220" height="220" fill="#6b5842"/>
    <rect x="240" y="480" width="1120" height="14" fill="#c9b69b"/>
    <text x="800" y="1010" font-family="Helvetica, Arial, sans-serif" font-size="34" text-anchor="middle" fill="#5d5346">Résidence des Tilleuls — illustration de démonstration</text>
  </svg>`;
  const original = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  const optimisee = await sharp(original).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return { original, optimisee };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Génère et écrit tous les fichiers physiques du dataset ; rend les faits dérivés (hash, tailles)
// que les lignes DB doivent porter. Écrit AVANT la transaction (comme signerBonVisite) : une
// transaction perdante ne laisse au pire que des fichiers réécrits par le prochain run.
async function ecrireFichiersSeed(dataset, racine) {
  const chemins = cheminsFichiersSeed(racine);
  await mkdir(racine, { recursive: true });
  await mkdir(path.join(racine, "photos", "originaux"), { recursive: true });
  await mkdir(path.join(racine, "photos", "optimisees"), { recursive: true });

  const faits = { documents: new Map(), bons: new Map(), photos: new Map() };

  for (const bon of dataset.bonsVisite) {
    const signaturePng = await genererPngSignature();
    const pdf = await genererPdfBonSigne(bon, signaturePng);
    await writeFile(chemins.signature(bon.signature.signatureCleStockage), signaturePng);
    const document = dataset.documents.find((d) => d.id === bon.documentId);
    await writeFile(chemins.document(document.cleStockage), pdf);
    faits.documents.set(document.id, { tailleOctets: pdf.byteLength });
    faits.bons.set(bon.id, { hashDocument: sha256(pdf) });
  }
  for (const document of dataset.documents) {
    if (document.contenu === "bon_visite") continue;
    const pdf = await genererPdfSimple(document.contenu);
    await writeFile(chemins.document(document.cleStockage), pdf);
    faits.documents.set(document.id, { tailleOctets: pdf.byteLength });
  }
  for (const photo of dataset.photos) {
    const { original, optimisee } = await genererPhoto();
    await writeFile(chemins.photoOriginale(photo.cleStockage), original);
    await writeFile(chemins.photoOptimisee(photo.cleStockage), optimisee);
    faits.photos.set(photo.id, { tailleOctetsOriginal: original.byteLength, hashSha256: sha256(original) });
  }
  return faits;
}

async function supprimerFichiersSeed(racine, cles) {
  const chemins = cheminsFichiersSeed(racine);
  for (const cle of cles.documents) await rm(chemins.document(cle), { force: true });
  for (const cle of cles.signatures) await rm(chemins.signature(cle), { force: true });
  for (const cle of cles.photos) {
    await rm(chemins.photoOriginale(cle), { force: true });
    await rm(chemins.photoOptimisee(cle), { force: true });
  }
}

// ───────────────────────────── GARDES ET PÉRIMÈTRE ─────────────────────────────

function verifierConfirmation(env) {
  if (env[NOM_VARIABLE_CONFIRMATION] !== VALEUR_CONFIRMATION_ATTENDUE) {
    throw new ErreurSeedDemo(
      "confirmation_manquante",
      `Seed refusé : confirmation explicite manquante. Relancer avec ${NOM_VARIABLE_CONFIRMATION}=${VALEUR_CONFIRMATION_ATTENDUE}.`
    );
  }
}

function tousLesIds() {
  return {
    contacts: Object.values(IDS.contacts),
    projetsVendeur: IDS.projetsVendeur,
    partiesProjet: IDS.partiesProjet,
    prospects: IDS.prospects,
    biens: IDS.biens,
    mandats: IDS.mandats,
    partiesMandat: IDS.partiesMandat,
    acquereurs: IDS.acquereurs,
    secteurs: IDS.secteurs,
    visites: Object.values(IDS.visites),
    comptesRendus: IDS.comptesRendus,
    bonsVisite: IDS.bonsVisite,
    signatures: IDS.signaturesBonVisite,
    offres: Object.values(IDS.offres),
    offreVisites: IDS.offreVisites,
    compromis: IDS.compromis,
    remunerations: IDS.remunerations,
    documents: Object.values(IDS.documents),
    photos: IDS.photos,
    interactions: IDS.interactions,
    taches: IDS.taches,
    notesBien: IDS.notesBien,
    notesProspect: IDS.notesProspect,
    evenements: IDS.evenements,
  };
}

// Le PÉRIMÈTRE du seed = ses entités déterministes + leurs dépendances directes créées ensuite par
// l'usage de la démo (un bien converti en direct depuis un prospect du seed, une visite planifiée
// sur un bien du seed, un compte rendu, un bon, des tâches automatiques, des événements et leurs
// exécutions, des états de compatibilité…). Tout ce qui est hors de ce périmètre est ÉTRANGER :
// le seed refuse alors d'écrire, jamais de supprimer. Calculé en SQL, jamais par workspace.
async function calculerPerimetreSeed(sql) {
  const ids = tousLesIds();
  const listes = (rows) => rows.map((r) => r.id);

  // Chaque liste ne contient que des lignes EXISTANTES (jamais un id attendu mais absent) : c'est
  // ce qui permet de compter précisément ce qui est étranger et ce qui est déjà présent.
  const contacts = listes(await sql`select id from contacts where id = any(${ids.contacts}::uuid[])`);
  const projetsVendeur = listes(await sql`select id from projets_vendeur where id = any(${ids.projetsVendeur}::uuid[])`);
  const prospects = listes(await sql`select id from prospects_vendeurs where id = any(${ids.prospects}::uuid[])`);
  // Biens : les nôtres + ceux nés d'une conversion en direct d'un prospect du seed.
  const biens = listes(await sql`
    select id from biens where id = any(${ids.biens}::uuid[])
      or id in (select bien_id from prospects_vendeurs where id = any(${prospects}::uuid[]) and bien_id is not null)
  `);
  const mandats = listes(await sql`select id from mandats where bien_id = any(${biens}::uuid[]) or projet_vendeur_id = any(${projetsVendeur}::uuid[])`);
  const partiesMandat = listes(await sql`select id from parties_mandat where mandat_id = any(${mandats}::uuid[]) or contact_id = any(${contacts}::uuid[])`);
  const partiesProjet = listes(await sql`select id from parties_projet where projet_vendeur_id = any(${projetsVendeur}::uuid[]) or contact_id = any(${contacts}::uuid[])`);
  const acquereurs = listes(await sql`select id from acquereurs where id = any(${ids.acquereurs}::uuid[])`);
  const secteurs = listes(await sql`select id from secteurs_recherche_acquereur where acquereur_id = any(${acquereurs}::uuid[])`);
  const visites = listes(await sql`select id from visites where bien_id = any(${biens}::uuid[]) or acquereur_id = any(${acquereurs}::uuid[])`);
  const comptesRendus = listes(await sql`select id from comptes_rendus_visite where bien_id = any(${biens}::uuid[]) or acquereur_id = any(${acquereurs}::uuid[])`);
  const bonsVisite = listes(await sql`select id from bons_visite where visite_id = any(${visites}::uuid[])`);
  const signatures = listes(await sql`select id from signatures_bon_visite where bon_visite_id = any(${bonsVisite}::uuid[])`);
  const offres = listes(await sql`select id from offres where bien_id = any(${biens}::uuid[]) or acquereur_id = any(${acquereurs}::uuid[])`);
  const offreVisites = listes(await sql`select id from offre_visites where offre_id = any(${offres}::uuid[]) or compte_rendu_visite_id = any(${comptesRendus}::uuid[])`);
  const compromis = listes(await sql`select id from compromis where bien_id = any(${biens}::uuid[]) or acquereur_id = any(${acquereurs}::uuid[])`);
  const remunerations = listes(await sql`select id from remuneration where compromis_id = any(${compromis}::uuid[])`);
  const documents = listes(await sql`select id from documents_bien where bien_id = any(${biens}::uuid[])`);
  const photos = listes(await sql`select id from photos_bien where bien_id = any(${biens}::uuid[])`);
  const interactions = listes(await sql`select id from interactions where contact_id = any(${contacts}::uuid[]) or bien_id = any(${biens}::uuid[]) or visite_id = any(${visites}::uuid[]) or projet_vendeur_id = any(${projetsVendeur}::uuid[])`);
  const taches = listes(await sql`
    select id from taches where id = any(${ids.taches}::uuid[])
      or bien_id = any(${biens}::uuid[]) or acquereur_id = any(${acquereurs}::uuid[]) or prospect_vendeur_id = any(${prospects}::uuid[])
      or visite_id = any(${comptesRendus}::uuid[]) or visite_canonique_id = any(${visites}::uuid[])
      or offre_id = any(${offres}::uuid[]) or compromis_id = any(${compromis}::uuid[]) or remuneration_id = any(${remunerations}::uuid[])
  `);
  const notesBien = listes(await sql`select id from notes_bien where bien_id = any(${biens}::uuid[])`);
  const notesProspect = listes(await sql`select id from notes_prospect_vendeur where prospect_vendeur_id = any(${prospects}::uuid[])`);
  const evenements = listes(await sql`
    select id from evenements_metier where id = any(${ids.evenements}::uuid[])
      or prospect_vendeur_id = any(${prospects}::uuid[]) or compte_rendu_visite_id = any(${comptesRendus}::uuid[])
      or compromis_id = any(${compromis}::uuid[]) or offre_id = any(${offres}::uuid[]) or mandat_id = any(${mandats}::uuid[])
      or visite_id = any(${visites}::uuid[]) or bon_visite_id = any(${bonsVisite}::uuid[])
      or bien_id = any(${biens}::uuid[]) or acquereur_id = any(${acquereurs}::uuid[])
  `);
  const executions = listes(await sql`select id from executions_automatisation where evenement_id = any(${evenements}::uuid[]) or tache_id = any(${taches}::uuid[])`);

  return {
    contacts, projetsVendeur, partiesProjet, prospects, biens, mandats, partiesMandat, acquereurs, secteurs,
    visites, comptesRendus, bonsVisite, signatures, offres, offreVisites, compromis, remunerations,
    documents, photos, interactions, taches, notesBien, notesProspect, evenements, executions,
  };
}

// Tables inspectées par la garde n°3 (données étrangères) : chaque ligne doit être dans le périmètre.
// `compatibilites_bien_acquereur_etat` et `compatibilites_a_resynchroniser` sont jugées par leurs
// FK (paires), jamais par un id.
const TABLES_METIER = [
  ["contacts", "contacts"], ["projets_vendeur", "projetsVendeur"], ["parties_projet", "partiesProjet"],
  ["prospects_vendeurs", "prospects"], ["biens", "biens"], ["mandats", "mandats"], ["parties_mandat", "partiesMandat"],
  ["acquereurs", "acquereurs"], ["secteurs_recherche_acquereur", "secteurs"], ["visites", "visites"],
  ["comptes_rendus_visite", "comptesRendus"], ["bons_visite", "bonsVisite"], ["signatures_bon_visite", "signatures"],
  ["offres", "offres"], ["offre_visites", "offreVisites"], ["compromis", "compromis"], ["remuneration", "remunerations"],
  ["documents_bien", "documents"], ["photos_bien", "photos"], ["interactions", "interactions"], ["taches", "taches"],
  ["notes_bien", "notesBien"], ["notes_prospect_vendeur", "notesProspect"], ["evenements_metier", "evenements"],
  ["executions_automatisation", "executions"],
];

async function inspecterBaseMetier(sql, perimetre) {
  const etrangeres = [];
  let presentes = 0;
  const attendues = Object.values(tousLesIds()).reduce((n, liste) => n + liste.length, 0);
  const ids = tousLesIds();

  for (const [table, cle] of TABLES_METIER) {
    const [{ total }] = await sql`select count(*)::int as total from ${sql(table)}`;
    const inconnues = total - perimetre[cle].length;
    if (inconnues > 0) etrangeres.push({ table, inconnues });
  }
  const [{ n: compatEtrangeres }] = await sql`
    select count(*)::int as n from compatibilites_bien_acquereur_etat
    where not (bien_id = any(${perimetre.biens}::uuid[]) and acquereur_id = any(${perimetre.acquereurs}::uuid[]))
  `;
  if (compatEtrangeres > 0) etrangeres.push({ table: "compatibilites_bien_acquereur_etat", inconnues: compatEtrangeres });
  const [{ n: resyncEtrangeres }] = await sql`
    select count(*)::int as n from compatibilites_a_resynchroniser
    where not (coalesce(bien_id = any(${perimetre.biens}::uuid[]), false) or coalesce(acquereur_id = any(${perimetre.acquereurs}::uuid[]), false))
  `;
  if (resyncEtrangeres > 0) etrangeres.push({ table: "compatibilites_a_resynchroniser", inconnues: resyncEtrangeres });

  for (const [table, cle] of TABLES_METIER) {
    if (!ids[cle]) continue;
    const [{ n }] = await sql`select count(*)::int as n from ${sql(table)} where id = any(${ids[cle]}::uuid[])`;
    presentes += n;
  }
  return { etrangeres, presentes, attendues };
}

// Suppression du SEUL périmètre du seed, enfants avant parents, sans TRUNCATE ni désactivation FK.
async function supprimerPerimetre(sql, perimetre) {
  const p = perimetre;
  await sql`delete from executions_automatisation where id = any(${p.executions}::uuid[])`;
  await sql`delete from evenements_metier where id = any(${p.evenements}::uuid[])`;
  await sql`delete from taches where id = any(${p.taches}::uuid[])`;
  await sql`delete from compatibilites_a_resynchroniser where bien_id = any(${p.biens}::uuid[]) or acquereur_id = any(${p.acquereurs}::uuid[])`;
  await sql`delete from compatibilites_bien_acquereur_etat where bien_id = any(${p.biens}::uuid[]) or acquereur_id = any(${p.acquereurs}::uuid[])`;
  await sql`delete from interactions where id = any(${p.interactions}::uuid[])`;
  await sql`delete from signatures_bon_visite where id = any(${p.signatures}::uuid[])`;
  await sql`delete from bons_visite where id = any(${p.bonsVisite}::uuid[])`;
  await sql`delete from documents_bien where id = any(${p.documents}::uuid[])`;
  await sql`delete from photos_bien where id = any(${p.photos}::uuid[])`;
  await sql`delete from remuneration where id = any(${p.remunerations}::uuid[])`;
  await sql`delete from compromis where id = any(${p.compromis}::uuid[])`;
  await sql`delete from offre_visites where id = any(${p.offreVisites}::uuid[])`;
  await sql`delete from offres where id = any(${p.offres}::uuid[])`;
  await sql`delete from comptes_rendus_visite where id = any(${p.comptesRendus}::uuid[])`;
  await sql`delete from visites where id = any(${p.visites}::uuid[])`;
  await sql`delete from notes_bien where id = any(${p.notesBien}::uuid[])`;
  await sql`delete from notes_prospect_vendeur where id = any(${p.notesProspect}::uuid[])`;
  await sql`delete from secteurs_recherche_acquereur where id = any(${p.secteurs}::uuid[])`;
  await sql`delete from parties_mandat where id = any(${p.partiesMandat}::uuid[])`;
  await sql`delete from prospects_vendeurs where id = any(${p.prospects}::uuid[])`;
  await sql`delete from mandats where id = any(${p.mandats}::uuid[])`;
  await sql`delete from biens where id = any(${p.biens}::uuid[])`;
  await sql`delete from acquereurs where id = any(${p.acquereurs}::uuid[])`;
  await sql`delete from parties_projet where id = any(${p.partiesProjet}::uuid[])`;
  await sql`delete from projets_vendeur where id = any(${p.projetsVendeur}::uuid[])`;
  await sql`delete from contacts where id = any(${p.contacts}::uuid[])`;
}

// Clés de stockage à retirer avec le périmètre : celles connues du dataset ET celles portées par
// les documents/photos/signatures du périmètre (un bon signé en direct pendant une démo, par ex.).
async function clesFichiersDuPerimetre(sql, perimetre, dataset) {
  const documents = await sql`select cle_stockage as cle from documents_bien where id = any(${perimetre.documents}::uuid[])`;
  const signatures = await sql`select signature_cle_stockage as cle from signatures_bon_visite where id = any(${perimetre.signatures}::uuid[])`;
  const photos = await sql`select cle_stockage as cle from photos_bien where id = any(${perimetre.photos}::uuid[])`;
  return {
    documents: [...new Set([...documents.map((d) => d.cle), ...dataset.documents.map((d) => d.cleStockage)])],
    signatures: [...new Set([...signatures.map((s) => s.cle), ...dataset.bonsVisite.map((b) => b.signature.signatureCleStockage)])],
    photos: [...new Set([...photos.map((p) => p.cle), ...dataset.photos.map((p) => p.cleStockage)])],
  };
}

// ───────────────────────────── INSERTION ─────────────────────────────

async function insererDataset(sql, dataset, faits, workspaceId) {
  for (const c of dataset.contacts) {
    await sql`insert into contacts (id, workspace_id, nom, prenom, email, telephone, cree_le, modifie_le)
      values (${c.id}, ${workspaceId}, ${c.nom}, ${c.prenom}, ${c.email}, ${c.telephone}, ${c.creeLe}, ${c.creeLe})`;
  }
  for (const pj of dataset.projetsVendeur) {
    await sql`insert into projets_vendeur (id, workspace_id, origine_lead, origine_lead_detail, mandat_propose_le, mandat_signe_le, motif_perte, date_perte, cree_le)
      values (${pj.id}, ${workspaceId}, ${pj.origineLead}, ${pj.origineLeadDetail}, ${pj.mandatProposeLe}, ${pj.mandatSigneLe}, ${pj.motifPerte ?? null}, ${pj.datePerte ?? null}, ${pj.creeLe})`;
  }
  for (const pp of dataset.partiesProjet) {
    await sql`insert into parties_projet (id, contact_id, projet_vendeur_id, role, cree_le)
      values (${pp.id}, ${pp.contactId}, ${pp.projetVendeurId}, ${pp.role}, ${pp.creeLe})`;
  }

  for (const b of dataset.biens) {
    await sql`
      insert into biens (
        id, reference, titre, type, adresse, ville, code_postal, code_insee_commune,
        surface, pieces, prix, statut_mandat, date_mandat, caracteristiques, description,
        etage, ascenseur, parking, exterieur, charge_honoraires, nom_copropriete,
        offre_en_cours_le, compromis_signe_le, cree_le, modifie_le, workspace_id
      ) values (
        ${b.id}, ${b.reference}, ${b.titre}, ${b.type}, ${b.adresse}, ${b.ville}, ${b.codePostal}, ${b.codeInseeCommune},
        ${b.surface}, ${b.pieces}, ${b.prix}, ${b.statutMandat}, ${b.dateMandat}, ${b.caracteristiques}, ${b.description},
        ${b.etage}, ${b.ascenseur}, ${b.parking}, ${b.exterieur}, ${b.chargeHonoraires}, ${b.nomCopropriete},
        ${b.offreEnCoursLe}, ${b.compromisSigneLe}, ${b.creeLe}, ${b.creeLe}, ${workspaceId}
      )`;
  }
  for (const m of dataset.mandats) {
    await sql`insert into mandats (id, bien_id, projet_vendeur_id, type, numero, date_debut, date_fin, exclusivite_jusqu_au, cree_le)
      values (${m.id}, ${m.bienId}, ${m.projetVendeurId}, ${m.type}, ${m.numero}, ${m.dateDebut}, ${m.dateFin}, ${m.exclusiviteJusquAu}, ${m.creeLe})`;
  }
  for (const pm of dataset.partiesMandat) {
    await sql`insert into parties_mandat (id, mandat_id, contact_id, role, cree_le)
      values (${pm.id}, ${pm.mandatId}, ${pm.contactId}, ${pm.role}, ${pm.creeLe})`;
  }

  for (const p of dataset.prospects) {
    await sql`
      insert into prospects_vendeurs (
        id, contact_id, projet_vendeur_id, nom, prenom, email, telephone, origine_lead, origine_lead_detail,
        adresse_bien_potentiel, secteur_bien_potentiel, ville, code_postal, type_bien,
        qualifie_le, estimation_proposee_centimes, estimation_proposee_le,
        rdv_estimation_prevu_le, rdv_estimation_realise_le, mandat_propose_le, mandat_signe_le,
        bien_id, motif_perte, date_perte, dernier_contact_le, cree_le, modifie_le, workspace_id
      ) values (
        ${p.id}, ${p.contactId}, ${p.projetVendeurId}, ${p.nom}, ${p.prenom}, ${p.email}, ${p.telephone}, ${p.origineLead}, ${p.origineLeadDetail},
        ${p.adresseBienPotentiel}, ${p.secteurBienPotentiel}, ${p.ville}, ${p.codePostal}, ${p.typeBien},
        ${p.qualifieLe}, ${p.estimationProposeeCentimes}, ${p.estimationProposeeLe},
        ${p.rdvEstimationPrevuLe}, ${p.rdvEstimationRealiseLe}, ${p.mandatProposeLe}, ${p.mandatSigneLe},
        ${p.bienId}, ${p.motifPerte}, ${p.datePerte}, ${p.dernierContactLe}, ${p.creeLe}, ${p.creeLe}, ${workspaceId}
      )`;
  }

  for (const a of dataset.acquereurs) {
    await sql`
      insert into acquereurs (
        id, contact_id, prenom, nom, email, telephone, budget_min, budget_max, criteres, stade_projet, notes,
        date_premiere_contact, pieces_min, surface_min, accessibilite_requise,
        necessite_parking, necessite_exterieur, cree_le, modifie_le, workspace_id
      ) values (
        ${a.id}, ${a.contactId}, ${a.prenom}, ${a.nom}, ${a.email}, ${a.telephone}, ${a.budgetMin}, ${a.budgetMax}, ${a.criteres}, ${a.stadeProjet}, ${a.notes},
        ${a.datePremiereContact}, ${a.piecesMin}, ${a.surfaceMin}, ${a.accessibiliteRequise},
        ${a.necessiteParking}, ${a.necessiteExterieur}, ${a.creeLe}, ${a.creeLe}, ${workspaceId}
      )`;
    for (const s of a.secteurs) {
      await sql`insert into secteurs_recherche_acquereur (id, acquereur_id, code_insee, nom_commune, code_postal, cree_le)
        values (${s.id}, ${a.id}, ${s.codeInsee}, ${s.nomCommune}, ${s.codePostal}, ${a.creeLe})`;
    }
  }

  for (const v of dataset.visites) {
    await sql`insert into visites (id, bien_id, acquereur_id, date_prevue, statut, rendez_vous_calendar_id, realisee_le, cree_le)
      values (${v.id}, ${v.bienId}, ${v.acquereurId}, ${v.datePrevue}, ${v.statut}, null, ${v.realiseeLe}, ${v.creeLe})`;
  }
  for (const cr of dataset.comptesRendus) {
    await sql`insert into comptes_rendus_visite (id, bien_id, acquereur_id, visite_id, date_visite, retour, interet, prochaine_etape, cree_le)
      values (${cr.id}, ${cr.bienId}, ${cr.acquereurId}, ${cr.visiteId}, ${cr.dateVisite}, ${cr.retour}, ${cr.interet}, ${cr.prochaineEtape}, ${cr.creeLe})`;
  }

  for (const d of dataset.documents) {
    const { tailleOctets } = faits.documents.get(d.id);
    await sql`
      insert into documents_bien (
        id, bien_id, visite_id, nom, categorie, type_document, nom_fichier_original, cle_stockage, taille_octets, type_mime,
        date_document, date_fin_validite, provenance, etat_verification, cree_le
      ) values (
        ${d.id}, ${d.bienId}, ${d.visiteId}, ${d.nom}, ${d.categorie}, ${d.typeDocument}, ${d.nomFichierOriginal}, ${d.cleStockage}, ${tailleOctets}, ${d.typeMime},
        ${d.dateDocument}, ${d.dateFinValidite}, ${d.provenance}, ${d.etatVerification}, ${d.creeLe}
      )`;
  }
  for (const bon of dataset.bonsVisite) {
    const { hashDocument } = faits.bons.get(bon.id);
    await sql`
      insert into bons_visite (id, visite_id, version, statut, template_version, contenu_snapshot, document_id, hash_document, cree_le, signe_le, annule_le)
      values (${bon.id}, ${bon.visiteId}, ${bon.version}, ${bon.statut}, ${bon.templateVersion}, ${sql.json(bon.contenuSnapshot)}, ${bon.documentId}, ${hashDocument}, ${bon.creeLe}, ${bon.signeLe}, null)`;
    const s = bon.signature;
    await sql`
      insert into signatures_bon_visite (id, bon_visite_id, contact_id, role_signataire, nom_snapshot, prenom_snapshot, email_snapshot, provider, external_signature_id, signature_cle_stockage, consentement_confirme_le, signe_le, cree_le)
      values (${s.id}, ${bon.id}, ${s.contactId}, ${s.roleSignataire}, ${s.nomSnapshot}, ${s.prenomSnapshot}, ${s.emailSnapshot}, 'domiora', null, ${s.signatureCleStockage}, ${bon.signeLe}, ${bon.signeLe}, ${bon.signeLe})`;
  }
  for (const photo of dataset.photos) {
    const { tailleOctetsOriginal, hashSha256 } = faits.photos.get(photo.id);
    await sql`insert into photos_bien (id, bien_id, cle_stockage, nom_fichier_original, type_mime_original, taille_octets_original, hash_sha256, ordre, cree_le)
      values (${photo.id}, ${photo.bienId}, ${photo.cleStockage}, ${photo.nomFichierOriginal}, ${photo.typeMimeOriginal}, ${tailleOctetsOriginal}, ${hashSha256}, ${photo.ordre}, ${photo.creeLe})`;
  }

  for (const i of dataset.interactions) {
    await sql`insert into interactions (id, contact_id, type, sens, survenu_le, contenu, bien_id, visite_id, nature_metier, cree_le)
      values (${i.id}, ${i.contactId}, ${i.type}, ${i.sens}, ${i.survenuLe}, ${i.contenu}, ${i.bienId}, ${i.visiteId}, ${i.natureMetier}, ${i.creeLe})`;
  }

  for (const o of dataset.offres) {
    await sql`insert into offres (id, bien_id, acquereur_id, montant, date_offre, statut, date_validite, date_decision, motif_perte, cree_le)
      values (${o.id}, ${o.bienId}, ${o.acquereurId}, ${o.montant}, ${o.dateOffre}, ${o.statut}, ${o.dateValidite}, ${o.dateDecision}, ${o.motifPerte}, ${o.creeLe})`;
  }
  for (const l of dataset.offreVisites) {
    await sql`insert into offre_visites (id, offre_id, compte_rendu_visite_id, cree_le) values (${l.id}, ${l.offreId}, ${l.compteRenduVisiteId}, ${l.creeLe})`;
  }
  for (const c of dataset.compromis) {
    await sql`
      insert into compromis (id, bien_id, acquereur_id, offre_id, prix_convenu, date_signature, date_acte, date_acte_reelle, date_annulation, motif_annulation, statut, cree_le)
      values (${c.id}, ${c.bienId}, ${c.acquereurId}, ${c.offreId}, ${c.prixConvenu}, ${c.dateSignature}, ${c.dateActe}, ${c.dateActeReelle}, ${c.dateAnnulation}, ${c.motifAnnulation}, ${c.statut}, ${c.creeLe})`;
  }
  for (const r of dataset.remunerations) {
    await sql`
      insert into remuneration (id, compromis_id, montant_honoraires_total_centimes, montant_remuneration_conseiller_centimes, date_encaissement_prevue, date_encaissement_reelle, cree_le)
      values (${r.id}, ${r.compromisId}, ${r.montantHonorairesTotalCentimes}, ${r.montantRemunerationConseillerCentimes}, ${r.dateEncaissementPrevue}, ${r.dateEncaissementReelle}, ${r.creeLe})`;
  }

  for (const t of dataset.taches) {
    await sql`
      insert into taches (
        id, titre, contexte, type, priorite, echeance, origine, origine_code,
        bien_id, acquereur_id, prospect_vendeur_id, visite_id, visite_canonique_id, offre_id, compromis_id, remuneration_id,
        cree_le, terminee_le, annulee_le, workspace_id
      ) values (
        ${t.id}, ${t.titre}, ${t.contexte ?? null}, ${t.type}, ${t.priorite}, ${t.echeance}, 'manuelle', null,
        ${t.bienId ?? null}, ${t.acquereurId ?? null}, ${t.prospectVendeurId ?? null}, null, null, null, ${t.compromisId ?? null}, null,
        ${t.creeLe}, ${t.termineeLe ?? null}, null, ${workspaceId}
      )`;
  }
  for (const n of dataset.notesBien) {
    await sql`insert into notes_bien (id, bien_id, contenu, cree_le) values (${n.id}, ${n.bienId}, ${n.contenu}, ${n.creeLe})`;
  }
  for (const n of dataset.notesProspect) {
    await sql`insert into notes_prospect_vendeur (id, prospect_vendeur_id, type, contenu, cree_le) values (${n.id}, ${n.prospectVendeurId}, ${n.type}, ${n.contenu}, ${n.creeLe})`;
  }
  for (const e of dataset.evenements) {
    await sql`insert into evenements_metier (id, type_evenement, prospect_vendeur_id, survenu_le, workspace_id)
      values (${e.id}, ${e.typeEvenement}, ${e.prospectVendeurId}, ${e.survenuLe}, ${workspaceId})`;
  }

  for (const c of dataset.compatibilitesAttendues) {
    await sql`insert into compatibilites_bien_acquereur_etat (bien_id, acquereur_id, dernier_statut, dans_perimetre_actif, cycle_compatibilite, observe_le)
      values (${c.bienId}, ${c.acquereurId}, ${c.statut}, true, 0, now())`;
  }

  // Règles de démonstration : upsert sur la PK réelle, le COUPLE (workspace_id, regle_code)
  // — migration 0054. La garde n°2 ci-dessous reste utile et devient une vérification de
  // cohérence du dataset plutôt qu'une protection contre un écrasement : depuis 0054, l'upsert ne
  // PEUT plus toucher la ligne d'un autre workspace, puisque le workspace fait partie de la clé.
  for (const regle of dataset.reglesDemo) {
    const [existante] = await sql`select workspace_id from configurations_automatisation where regle_code = ${regle.regleCode}`;
    if (existante && existante.workspace_id !== workspaceId) {
      throw new ErreurSeedDemo("configuration_autre_workspace", `La règle ${regle.regleCode} est configurée pour un autre workspace (${existante.workspace_id}).`);
    }
    await sql`
      insert into configurations_automatisation (regle_code, active, seuil_jours, workspace_id, modifie_le)
      values (${regle.regleCode}, true, ${regle.seuilJours}, ${workspaceId}, now())
      on conflict (workspace_id, regle_code) do update set active = true, seuil_jours = excluded.seuil_jours, modifie_le = now()
    `;
  }
}

// ───────────────────────────── POINT D'ENTRÉE ─────────────────────────────

/**
 * @param {import("postgres").Sql} sql
 * @param {{ env?: Record<string, string | undefined>, maintenant?: Date }} [options]
 */
export async function executerSeedDemo(sql, { env = process.env, maintenant = new Date() } = {}) {
  verifierConfirmation(env);
  const dataset = construireDataset(maintenant);
  const racine = resoudreRepertoireStockage(env);

  return sql.begin(async (tx) => {
    // Garde n°2 — un seul workspace, lu en base (ADR-054).
    const workspaces = await tx`select id from workspaces limit 2`;
    if (workspaces.length !== 1) {
      throw new ErreurSeedDemo("workspace_unique_attendu", `Seed impossible : ${workspaces.length} workspace(s) en base. Un seul est attendu tant que le produit est mono-conseiller (ADR-054).`);
    }
    const workspaceId = workspaces[0].id;

    // Garde n°3 — aucune donnée étrangère au périmètre du seed.
    const perimetre = await calculerPerimetreSeed(tx);
    const { etrangeres, presentes, attendues } = await inspecterBaseMetier(tx, perimetre);
    if (etrangeres.length > 0) {
      const detail = etrangeres.map((t) => `${t.table} (${t.inconnues})`).join(", ");
      throw new ErreurSeedDemo(
        "donnees_metier_inconnues",
        `Seed refusé : cette base contient déjà des données métier qui n'appartiennent pas au dataset de démonstration — ${detail}. Aucune écriture, aucune suppression.`
      );
    }

    // Rejouabilité — le périmètre existant (complet, partiel ou enrichi par l'usage de la démo) est
    // retiré, fichiers compris, puis tout est recréé : même état final à chaque run.
    let statut = "cree";
    if (presentes > 0) {
      const cles = await clesFichiersDuPerimetre(tx, perimetre, dataset);
      await supprimerPerimetre(tx, perimetre);
      await supprimerFichiersSeed(racine, cles);
      statut = presentes === attendues ? "recree" : "recree_depuis_partiel";
    }

    const faits = await ecrireFichiersSeed(dataset, racine);
    await insererDataset(tx, dataset, faits, workspaceId);
    return { statut, compteurs: compteurs(dataset), racineStockage: racine };
  });
}

export function compteurs(dataset) {
  return {
    contacts: dataset.contacts.length,
    projetsVendeur: dataset.projetsVendeur.length,
    prospects: dataset.prospects.length,
    biens: dataset.biens.length,
    mandats: dataset.mandats.length,
    partiesMandat: dataset.partiesMandat.length,
    acquereurs: dataset.acquereurs.length,
    secteurs: dataset.acquereurs.reduce((n, a) => n + a.secteurs.length, 0),
    visites: dataset.visites.length,
    comptesRendus: dataset.comptesRendus.length,
    bonsVisite: dataset.bonsVisite.length,
    documents: dataset.documents.length,
    photos: dataset.photos.length,
    interactions: dataset.interactions.length,
    offres: dataset.offres.length,
    compromis: dataset.compromis.length,
    remunerations: dataset.remunerations.length,
    taches: dataset.taches.length,
    notes: dataset.notesBien.length + dataset.notesProspect.length,
    evenements: dataset.evenements.length,
    compatibilites: dataset.compatibilitesAttendues.length,
    regles: dataset.reglesDemo.length,
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
    const { statut, compteurs: c, racineStockage } = await executerSeedDemo(sql);
    console.log("DOMIORA — Seed de démonstration");
    console.log(statut === "cree" ? "Dataset créé sur une base vierge." : `Dataset recréé (${statut}) : périmètre précédent retiré puis reconstruit.`);
    console.log(`${c.contacts} contacts, ${c.projetsVendeur} projets vendeur, ${c.prospects} prospects vendeurs`);
    console.log(`${c.biens} biens, ${c.mandats} mandats, ${c.partiesMandat} parties mandant`);
    console.log(`${c.acquereurs} acquéreurs, ${c.secteurs} secteurs de recherche, ${c.compatibilites} états de compatibilité`);
    console.log(`${c.visites} visites natives, ${c.comptesRendus} comptes rendus, ${c.bonsVisite} bon de visite signé`);
    console.log(`${c.documents} documents, ${c.photos} photo, ${c.interactions} interactions`);
    console.log(`${c.offres} offres, ${c.compromis} compromis, ${c.remunerations} rémunération prévisionnelle`);
    console.log(`${c.taches} tâches, ${c.notes} notes, ${c.evenements} événements métier, ${c.regles} règles activées`);
    console.log(`Fichiers écrits sous ${racineStockage}`);
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
