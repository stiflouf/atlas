import { pgTable, text, real, integer, boolean, date, timestamp, uuid, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Produit mono-conseiller pour l'instant (voir ADR-006) : une seule ligne possible,
// toujours identifiée par id = 'default'. Pas de notion d'utilisateur/session en base.
export const connexionsGoogle = pgTable("connexions_google", {
  id: text("id").primaryKey().default("default"),
  refreshTokenChiffre: text("refresh_token_chiffre").notNull(),
  scope: text("scope").notNull(),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
});

// Mémoire contextuelle d'Atlas : la correspondance métier (bien/client/type) qu'Atlas retient
// pour un élément externe donné, quelle que soit son origine (Google Calendar aujourd'hui ;
// Gmail, SMS, WhatsApp, documents demain). Ajouter un connecteur ne crée jamais de nouvelle
// table : seulement de nouvelles lignes avec un `source`/`typeElement` différents.
// bienId/clientId restent des références texte vers le catalogue mocké (data/biens.ts,
// data/clients.ts) — pas de FK : ces catalogues ne vivent pas encore en base (hors périmètre).
export const memoireContextuelle = pgTable(
  "memoire_contextuelle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    typeElement: text("type_element").notNull(),
    identifiantExterne: text("identifiant_externe").notNull(),
    bienId: text("bien_id"),
    clientId: text("client_id"),
    typeMetier: text("type_metier").notNull().default("autre"),
    confidenceBien: real("confidence_bien"),
    confidenceClient: real("confidence_client"),
    confidenceType: real("confidence_type"),
    overallConfidence: real("overall_confidence").notNull(),
    statutValidation: text("statut_validation").notNull().default("auto"),
    empreinteContenu: text("empreinte_contenu"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("memoire_contextuelle_source_identifiant_externe_unique").on(
      table.source,
      table.identifiantExterne
    ),
    check(
      "memoire_contextuelle_type_metier_check",
      sql`${table.typeMetier} IN ('visite','estimation','appel','signature','prospection','autre')`
    ),
    check(
      "memoire_contextuelle_statut_validation_check",
      sql`${table.statutValidation} IN ('auto','confirme','corrige','ignore')`
    ),
  ]
);

// Premier bien réel persisté (hors mocks data/biens.ts). Les colonnes etage/ascenseur/parking/
// exterieur sont nullable sans défaut : NULL = information inconnue, jamais interprétée comme
// false ou "aucun" — c'est le repository qui traduit NULL -> undefined côté type métier.
export const biens = pgTable(
  "biens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull(),
    titre: text("titre").notNull(),
    type: text("type").notNull(),
    adresse: text("adresse").notNull(),
    ville: text("ville").notNull(),
    codePostal: text("code_postal").notNull(),
    surface: real("surface").notNull(),
    pieces: integer("pieces").notNull(),
    prix: integer("prix").notNull(),
    statutMandat: text("statut_mandat").notNull().default("actif"),
    dateMandat: date("date_mandat").notNull(),
    caracteristiques: text("caracteristiques").array().notNull().default([]),
    description: text("description").notNull().default(""),
    etage: integer("etage"),
    ascenseur: boolean("ascenseur"),
    parking: boolean("parking"),
    exterieur: text("exterieur"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
    // NULL = actif, non-NULL = archivé à cet instant (ADR-012). Sorti des flux actifs (listes,
    // matching) sans suppression physique — jamais touché par une édition (modifierBien ne le
    // référence pas dans son SET).
    archiveLe: timestamp("archive_le", { withTimezone: true }),
    // Jalons du statut commercial du bien (ADR-014) : timestamps de jalons plutôt qu'un enum,
    // source de vérité unique, aucun champ statut dérivé stocké. NULL/NULL = en commercialisation.
    // compromisSigneLe peut être posé sans offreEnCoursLe (compromis marqué directement) — jamais
    // l'inverse ne doit être créé artificiellement par le code applicatif.
    offreEnCoursLe: timestamp("offre_en_cours_le", { withTimezone: true }),
    compromisSigneLe: timestamp("compromis_signe_le", { withTimezone: true }),
  },
  (table) => [
    check("biens_type_check", sql`${table.type} IN ('appartement','maison','studio','loft','local_commercial')`),
    check("biens_statut_mandat_check", sql`${table.statutMandat} IN ('actif','suspendu','expire')`),
    check(
      "biens_exterieur_check",
      sql`${table.exterieur} IS NULL OR ${table.exterieur} IN ('aucun','balcon','terrasse','jardin')`
    ),
  ]
);

// Premier acquéreur réel persisté (hors mocks data/clients.ts). Mêmes principes que `biens` :
// colonnes nullable sans défaut pour les champs structurés optionnels.
export const acquereurs = pgTable(
  "acquereurs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prenom: text("prenom").notNull(),
    nom: text("nom").notNull(),
    email: text("email").notNull(),
    telephone: text("telephone").notNull(),
    budgetMin: integer("budget_min").notNull(),
    budgetMax: integer("budget_max").notNull(),
    criteres: text("criteres").array().notNull().default([]),
    stadeProjet: text("stade_projet").notNull().default("decouverte"),
    notes: text("notes").notNull().default(""),
    datePremiereContact: date("date_premiere_contact").notNull(),
    piecesMin: integer("pieces_min"),
    surfaceMin: real("surface_min"),
    accessibiliteRequise: boolean("accessibilite_requise"),
    necessiteParking: boolean("necessite_parking"),
    necessiteExterieur: boolean("necessite_exterieur"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
    // Même principe que biens.archiveLe (ADR-012).
    archiveLe: timestamp("archive_le", { withTimezone: true }),
  },
  (table) => [
    check(
      "acquereurs_stade_projet_check",
      sql`${table.stadeProjet} IN ('decouverte','recherche_active','offre','compromis','acte')`
    ),
  ]
);

// Notes libres sur un bien réel. Contrairement à actions/memoireContextuelle, bienId est une
// vraie FK : une note ne peut être créée que depuis la fiche d'un bien déjà réel (pas de
// formulaire équivalent sur un bien mocké), donc pas de cas mixte id-mock/id-réel à accommoder.
// Pas de modifieLe : append-only, aucune édition prévue pour l'instant.
export const notesBien = pgTable("notes_bien", {
  id: uuid("id").primaryKey().defaultRandom(),
  bienId: uuid("bien_id")
    .notNull()
    .references(() => biens.id, { onDelete: "cascade" }),
  contenu: text("contenu").notNull(),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

// Document réel attaché à un bien. bienId est une vraie FK, même rationale que notes_bien : un
// document n'est attachable que depuis la fiche d'un bien déjà réel. cleStockage est un
// identifiant opaque généré côté serveur (jamais dérivé d'un nom fourni par l'utilisateur) — le
// chemin physique sur disque est reconstruit uniquement dans src/lib/stockageDocuments.ts à
// partir de STORAGE_ROOT + cleStockage. Append-only comme notes_bien/comptes_rendus_visite
// (ADR-011) : aucune suppression en V1 — voir docs/adr pour le stockage (ON DELETE CASCADE
// nettoie la ligne DB mais jamais le fichier physique, à traiter le jour où une suppression est
// implémentée).
export const documentsBien = pgTable(
  "documents_bien",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bienId: uuid("bien_id")
      .notNull()
      .references(() => biens.id, { onDelete: "cascade" }),
    nom: text("nom").notNull(),
    categorie: text("categorie").notNull().default("autre"),
    nomFichierOriginal: text("nom_fichier_original").notNull(),
    cleStockage: text("cle_stockage").notNull(),
    tailleOctets: integer("taille_octets").notNull(),
    typeMime: text("type_mime").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "documents_bien_categorie_check",
      sql`${table.categorie} IN ('mandat','diagnostic','copropriete','technique','commercial','compromis','autre')`
    ),
  ]
);

// Compte rendu après une visite. bienId/acquereurId sont de vraies FK, même rationale que
// notes_bien : un compte rendu n'est créable que depuis /visites/[id]/preparer, où bien et
// acquéreur sont déjà résolus et réels. dateVisite (date réelle de la visite, préremplie depuis
// le rendez-vous mais modifiable) est volontairement distincte de creeLe (instant de saisie).
// Pas de modifieLe : append-only, aucune édition prévue pour l'instant.
export const comptesRendusVisite = pgTable(
  "comptes_rendus_visite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bienId: uuid("bien_id")
      .notNull()
      .references(() => biens.id, { onDelete: "cascade" }),
    acquereurId: uuid("acquereur_id")
      .notNull()
      .references(() => acquereurs.id, { onDelete: "cascade" }),
    dateVisite: date("date_visite").notNull(),
    retour: text("retour").notNull(),
    interet: text("interet").notNull().default("inconnu"),
    prochaineEtape: text("prochaine_etape"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "comptes_rendus_visite_interet_check",
      sql`${table.interet} IN ('interesse','a_reflechir','pas_interesse','inconnu')`
    ),
  ]
);

// Offre structurée sur un bien (ADR-015). bienId/acquereurId sont de vraies FK, même rationale
// que comptes_rendus_visite. montant/acquereurId/bienId/dateOffre sont immuables après création :
// une nouvelle proposition = une nouvelle ligne, jamais une édition. statut est le seul champ
// mutable (UPDATE en place, comme actions.statut), transitions unidirectionnelles depuis
// 'en_cours' uniquement — validées côté Server Action, pas en CHECK SQL. Couplage unidirectionnel
// avec biens.offreEnCoursLe : créer une offre le pose, mais aucun changement de statut ne le
// modifie (voir src/actions/offre.ts).
// dateDecision/motifPerte (ADR-020) : posés atomiquement avec statut lors de la transition finale
// (acceptee/refusee/retiree — voir TransitionFinaleOffre, src/lib/offreRepository.ts). Nullables
// sans corrélation CHECK avec statut : les lignes historiques créées avant cette fonctionnalité
// restent valides sans date ni motif (aucun backfill), une contrainte "statut final => date/motif
// non nul" les casserait. motif_perte : CHECK sur la valeur uniquement (vocabulaire MotifPerte),
// jamais sur son obligation, qui reste entièrement portée par la Server Action.
export const offres = pgTable(
  "offres",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bienId: uuid("bien_id")
      .notNull()
      .references(() => biens.id, { onDelete: "cascade" }),
    acquereurId: uuid("acquereur_id")
      .notNull()
      .references(() => acquereurs.id, { onDelete: "cascade" }),
    montant: integer("montant").notNull(),
    dateOffre: date("date_offre").notNull(),
    statut: text("statut").notNull().default("en_cours"),
    dateValidite: date("date_validite"),
    dateDecision: date("date_decision"),
    motifPerte: text("motif_perte"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("offres_statut_check", sql`${table.statut} IN ('en_cours','acceptee','refusee','retiree')`),
    check(
      "offres_motif_perte_check",
      sql`${table.motifPerte} IS NULL OR ${table.motifPerte} IN ('financement_refuse','acquereur_se_retire','vendeur_se_retire','desaccord_prix','juridique_administratif','delai_calendrier','autre')`
    ),
  ]
);

// Compromis structuré sur un bien (ADR-016). bienId/acquereurId sont de vraies FK, même rationale
// que offres. offreId nullable (ON DELETE SET NULL, pas cascade : un compromis ne doit jamais
// disparaître si son offre d'origine venait à être supprimée) — un compromis peut être marqué
// directement sans offre structurée préalable. prixConvenu/bienId/acquereurId/offreId/
// dateSignature immuables après création : une nouvelle signature = une nouvelle ligne. statut
// est le seul champ mutable (UPDATE en place, comme offres.statut), transitions
// unidirectionnelles depuis 'en_cours' uniquement — validées côté Server Action. Un seul
// compromis 'en_cours' par bien à la fois : garde applicative, pas une contrainte SQL. Couplage
// unidirectionnel avec biens.compromisSigneLe : créer un compromis le pose, mais aucun changement
// de statut ne le modifie (voir src/actions/compromis.ts).
// dateActe (prévue) et dateActeReelle (constatée) sont deux champs distincts et jamais fusionnés
// (ADR-017) : dateActe ne change jamais après création, dateActeReelle n'est posée qu'au passage
// à 'realise', atomiquement avec le changement de statut. Distinction conservée pour permettre
// plus tard un suivi de pipeline/délais/CA prévisionnel vs réalisé — aucun calcul de ce type
// n'existe dans cette passe.
// Lien explicite visite -> offre (ADR-019), many-to-many via table de jonction : plusieurs
// comptes rendus peuvent précéder une même offre, et un même compte rendu peut aussi précéder
// plusieurs offres successives (une offre refusée n'empêche pas une nouvelle offre du même
// acquéreur sur le même bien). Cascade des deux côtés (contrairement à compromis.offreId en SET
// NULL) : une ligne de liaison n'a aucun sens indépendamment de l'offre et du compte rendu
// qu'elle relie — elle disparaît avec l'un ou l'autre. Correspondance bienId/acquereurId et
// dateVisite <= dateOffre : validées côté Server Action (jamais en CHECK SQL, même principe que
// offres.statut/compromis.statut), car ce sont des comparaisons entre deux tables. La contrainte
// unique, elle, ne porte que sur les colonnes de cette table : elle reste en base comme dernier
// filet de sécurité contre un doublon.
export const offreVisites = pgTable(
  "offre_visites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offreId: uuid("offre_id")
      .notNull()
      .references(() => offres.id, { onDelete: "cascade" }),
    compteRenduVisiteId: uuid("compte_rendu_visite_id")
      .notNull()
      .references(() => comptesRendusVisite.id, { onDelete: "cascade" }),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("offre_visites_offre_id_compte_rendu_visite_id_unique").on(
      table.offreId,
      table.compteRenduVisiteId
    ),
  ]
);

export const compromis = pgTable(
  "compromis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bienId: uuid("bien_id")
      .notNull()
      .references(() => biens.id, { onDelete: "cascade" }),
    acquereurId: uuid("acquereur_id")
      .notNull()
      .references(() => acquereurs.id, { onDelete: "cascade" }),
    offreId: uuid("offre_id").references(() => offres.id, { onDelete: "set null" }),
    prixConvenu: integer("prix_convenu").notNull(),
    dateSignature: date("date_signature").notNull(),
    dateActe: date("date_acte"),
    dateActeReelle: date("date_acte_reelle"),
    // dateAnnulation/motifAnnulation (ADR-020) : posés atomiquement avec statut uniquement lors de
    // la transition vers 'annule' (marquerCompromisAnnule) — 'realise' continue d'utiliser
    // exclusivement dateActeReelle, jamais ces deux colonnes. Même absence de corrélation CHECK
    // avec statut qu'offres.dateDecision/motifPerte, pour la même raison (pas de backfill).
    dateAnnulation: date("date_annulation"),
    motifAnnulation: text("motif_annulation"),
    statut: text("statut").notNull().default("en_cours"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("compromis_statut_check", sql`${table.statut} IN ('en_cours','realise','annule')`),
    check(
      "compromis_motif_annulation_check",
      sql`${table.motifAnnulation} IS NULL OR ${table.motifAnnulation} IN ('financement_refuse','acquereur_se_retire','vendeur_se_retire','desaccord_prix','juridique_administratif','delai_calendrier','autre')`
    ),
  ]
);

// Racine du dossier fiscal (ADR-023). Mono-dossier aujourd'hui, même patron que connexions_google
// (ADR-006) : une seule ligne id='default', créée à la demande par le repository (jamais en
// migration/seed). profil_fiscal/historique_amorcage/rfr_foyer référencent cette table plutôt que
// d'exister isolément : le jour où Atlas gère plusieurs conseillers, un futur rattachement
// conseiller -> dossier_fiscal (1:1 ou N:1) sera additif — aucune de ces trois tables n'a besoin
// d'être retouchée, seul dossier_fiscal gagnera une colonne conseillerId.
export const dossierFiscal = pgTable("dossier_fiscal", {
  id: text("id").primaryKey().default("default"),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

// Profil fiscal du conseiller (ADR-023) : instantané complet historisé, jamais un historique
// champ par champ. Les paramètres sont interdépendants (l'option débits n'a de sens qu'avec un
// régime TVA donné) — un instantané garantit qu'à toute date lue, la combinaison reste cohérente.
// Append-only : une correction, même rétroactive, s'écrit toujours comme une nouvelle ligne,
// jamais une édition en place.
//
// Résolution "profil à la date D" (chargerProfilFiscalADate) : la ligne la plus récente dont
// date_debut_validite <= D. Aucune contrainte n'impose date_debut_validite postérieure à la
// dernière ligne existante — Atlas doit permettre de renseigner rétroactivement un changement de
// situation découvert après coup. En cas d'égalité exacte de date_debut_validite entre plusieurs
// lignes du même dossier (une correction saisie le même jour métier qu'un instantané déjà
// existant), la ligne la plus récemment créée (cree_le) fait foi pour la lecture — aucune ligne
// n'est jamais supprimée, seul l'ordre de résolution départage l'égalité.
//
// regime_comptable concerne exclusivement la lecture des recettes BNC (pertinent seulement si
// regime_fiscal = 'declaration_controlee' ; le micro-BNC est en comptabilité de caisse par
// construction légale). Il n'intervient dans aucune détermination du CA de référence TVA — cette
// dernière dépend de regime_tva et de option_debits, jamais de regime_comptable (voir ADR-023).
//
// 'inconnu' est une vraie valeur stockée, distincte de l'absence de ligne (ADR-009 : NULL
// différent de false, généralisé ici à "non renseigné"). Absence de ligne = jamais interrogé ;
// 'inconnu' = interrogé, réponse "je ne sais pas" — Atlas n'en déduit jamais un régime par défaut.
// Les CHECK ci-dessous valident uniquement le vocabulaire de chaque colonne ; les règles croisées
// (regime_comptable pertinent seulement en déclaration contrôlée, option_debits pertinent
// seulement hors franchise, cohérence acre_date_debut/acre_date_fin avec acre_actif) sont
// entièrement portées par la Server Action (src/actions/profilFiscal.ts), même séparation que
// motif_perte/motif_annulation.
export const profilFiscal = pgTable(
  "profil_fiscal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossierFiscalId: text("dossier_fiscal_id")
      .notNull()
      .references(() => dossierFiscal.id, { onDelete: "cascade" }),
    dateDebutValidite: date("date_debut_validite").notNull(),
    natureActivite: text("nature_activite").notNull().default("agent_commercial_immobilier"),
    dateDebutActivite: date("date_debut_activite").notNull(),
    regimeFiscal: text("regime_fiscal").notNull(),
    regimeComptable: text("regime_comptable"),
    regimeTva: text("regime_tva").notNull(),
    optionDebits: boolean("option_debits"),
    periodiciteUrssaf: text("periodicite_urssaf").notNull(),
    optionVersementLiberatoire: boolean("option_versement_liberatoire"),
    acreActif: boolean("acre_actif"),
    acreDateDebut: date("acre_date_debut"),
    acreDateFin: date("acre_date_fin"),
    affiliationRetraite: text("affiliation_retraite").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "profil_fiscal_nature_activite_check",
      sql`${table.natureActivite} IN ('agent_commercial_immobilier')`
    ),
    check(
      "profil_fiscal_regime_fiscal_check",
      sql`${table.regimeFiscal} IN ('micro_bnc','declaration_controlee','inconnu')`
    ),
    check(
      "profil_fiscal_regime_comptable_check",
      sql`${table.regimeComptable} IS NULL OR ${table.regimeComptable} IN ('caisse','engagement','inconnu')`
    ),
    check(
      "profil_fiscal_regime_tva_check",
      sql`${table.regimeTva} IN ('franchise','redevable_reel_simplifie','redevable_reel_normal','inconnu')`
    ),
    check(
      "profil_fiscal_periodicite_urssaf_check",
      sql`${table.periodiciteUrssaf} IN ('mensuelle','trimestrielle','inconnu')`
    ),
    check(
      "profil_fiscal_affiliation_retraite_check",
      sql`${table.affiliationRetraite} IN ('ssi_regime_general','cipav','inconnu')`
    ),
  ]
);

// Agrégat annuel d'amorçage (ADR-023, point 2/3) : recettes encaissées avant l'usage d'Atlas.
// Corrigible (upsert par (dossier_fiscal_id, annee)) — contrairement à profil_fiscal, ce n'est pas
// un fait historisé mais une estimation d'amorçage.
//
// date_fin_couverture porte l'invariant anti-double-comptage : montant_encaisse_centimes ne
// couvre que les encaissements jusqu'à cette date incluse. Tout fait Atlas utilisé en complément
// (remuneration.dateEncaissementReelle) doit être strictement postérieur à date_fin_couverture —
// jamais additionné à l'aveugle. Pour une année révolue avant l'usage d'Atlas, la Server Action
// pose automatiquement date_fin_couverture au 31 décembre de l'année (couverture totale, aucun
// fait Atlas ne peut de toute façon exister avant qu'Atlas n'existe) ; seule l'année en cours au
// moment de la saisie expose réellement le champ à l'utilisateur.
//
// Absence de ligne pour une année = couverture antérieure inconnue, jamais assimilée à un CA de 0
// (point 3) : si Atlas ne possède que les encaissements depuis septembre, la somme de ces
// encaissements ne doit jamais être présentée comme le CA annuel complet sans confirmation
// explicite de la période janvier-août. Une ligne avec montant_encaisse_centimes = 0 est un zéro
// confirmé explicitement par le conseiller, distinct de cette absence. Voir
// historiqueAmorcageRepository.chargerCouvertureAnnee pour le contrat de lecture correspondant
// (préparé ici pour le futur résolveur d'ADR-024).
export const historiqueAmorcage = pgTable(
  "historique_amorcage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossierFiscalId: text("dossier_fiscal_id")
      .notNull()
      .references(() => dossierFiscal.id, { onDelete: "cascade" }),
    annee: integer("annee").notNull(),
    montantEncaisseCentimes: integer("montant_encaisse_centimes").notNull(),
    dateFinCouverture: date("date_fin_couverture").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }),
  },
  (table) => [
    unique("historique_amorcage_dossier_annee_unique").on(table.dossierFiscalId, table.annee),
    check("historique_amorcage_montant_positif_check", sql`${table.montantEncaisseCentimes} >= 0`),
    check(
      "historique_amorcage_date_fin_couverture_annee_check",
      sql`extract(year from ${table.dateFinCouverture}) = ${table.annee}`
    ),
  ]
);

// RFR du foyer par année (ADR-023, point 3) : entièrement séparé de historique_amorcage — le RFR
// est une donnée du foyer fiscal, pas de l'activité, et ne sert qu'au contrôle optionnel
// d'éligibilité au versement libératoire. Table entièrement optionnelle : zéro ligne n'empêche
// jamais profil_fiscal.optionVersementLiberatoire = true — un conseiller peut avoir activé le VFL
// sans vouloir qu'Atlas surveille sa future éligibilité.
//
// nombre_parts_centiemes : entier exact (1,5 part = 150), jamais un flottant — voir
// remuneration.montantRemunerationConseillerCentimes pour le même principe appliqué à l'argent.
// Le rapport RFR/part utilisé pour comparer au seuil légal est dérivé au moment du calcul (futur
// ADR-024), jamais saisi ni stocké : l'utilisateur donne le RFR du foyer et le nombre de parts
// tels quels, Atlas divise.
export const rfrFoyer = pgTable(
  "rfr_foyer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossierFiscalId: text("dossier_fiscal_id")
      .notNull()
      .references(() => dossierFiscal.id, { onDelete: "cascade" }),
    anneeRfr: integer("annee_rfr").notNull(),
    rfrFoyerCentimes: integer("rfr_foyer_centimes").notNull(),
    nombrePartsCentiemes: integer("nombre_parts_centiemes").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }),
  },
  (table) => [
    unique("rfr_foyer_dossier_annee_unique").on(table.dossierFiscalId, table.anneeRfr),
    check("rfr_foyer_montant_positif_check", sql`${table.rfrFoyerCentimes} >= 0`),
    check("rfr_foyer_parts_positif_check", sql`${table.nombrePartsCentiemes} > 0`),
  ]
);

// Référentiel légal (ADR-023, point 4) : uniquement des paramètres légaux datés (taux, seuils,
// abattements, durées) — jamais un algorithme. Les mécanismes (deux années consécutives
// micro-BNC, prorata temporis, franchissement de seuil TVA, barème ACRE) vivent en code, versionnés
// et testés séparément, chacun documentant en commentaire les `code` ci-dessous qu'il consomme.
// Aucun taux légal ne doit exister ailleurs que dans cette table.
//
// Aucune donnée monétaire ou fiscale en flottant (point 4) : valeur est un entier exact, dont
// l'unité fixe la représentation — 'centimes' pour un montant, 'points_base' pour un taux
// (25,6 % = 2560 points de base, 1 % = 100 points de base), 'jours' pour une durée. Jamais de
// conversion flottante côté JS.
//
// Convention temporelle (point 5) : intervalle semi-ouvert [date_debut_validite,
// date_fin_validite[ — date_fin_validite exclue (la règle cesse de s'appliquer exactement ce
// jour-là), NULL = pas de fin connue. Pour un même (code, categorie_activite), deux règles ne
// doivent jamais se chevaucher : la validation est portée par
// referentielFiscalRepository.insererRegleFiscale (pas de CHECK SQL inter-lignes), appelée par le
// seul chemin d'écriture existant (script/seed) — aucune Server Action utilisateur n'écrit dans ce
// référentiel.
//
// statut_verification trace le niveau de confiance établi lors de l'audit source par source :
// 'verifie_direct' (lecture directe du texte officiel), 'recoupement' (plusieurs sources
// secondaires convergentes, non lu directement), 'a_confirmer' (source encore incertaine ou
// divergente). Une règle != 'verifie_direct' ne doit jamais alimenter un résultat présenté comme
// officiel (appliqué par le futur moteur de calcul, ADR-024) — le champ est toujours retourné par
// resoudreRegle, jamais masqué.
export const regleFiscale = pgTable(
  "regle_fiscale",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    categorieActivite: text("categorie_activite").notNull(),
    valeur: integer("valeur").notNull(),
    unite: text("unite").notNull(),
    dateDebutValidite: date("date_debut_validite").notNull(),
    dateFinValidite: date("date_fin_validite"),
    sourceLibelle: text("source_libelle").notNull(),
    sourceUrl: text("source_url").notNull(),
    datePublicationSource: date("date_publication_source"),
    statutVerification: text("statut_verification").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("regle_fiscale_code_categorie_debut_unique").on(
      table.code,
      table.categorieActivite,
      table.dateDebutValidite
    ),
    check("regle_fiscale_unite_check", sql`${table.unite} IN ('centimes','points_base','jours')`),
    check(
      "regle_fiscale_statut_verification_check",
      sql`${table.statutVerification} IN ('verifie_direct','recoupement','a_confirmer')`
    ),
    check(
      "regle_fiscale_periode_check",
      sql`${table.dateFinValidite} IS NULL OR ${table.dateFinValidite} > ${table.dateDebutValidite}`
    ),
  ]
);

// Rémunération du conseiller sur un compromis (ADR-021), 1:1 strict — compromisId UNIQUE, une seule
// ligne pour toute la durée de vie d'un compromis, jamais de paiement partiel/plusieurs versements
// en V1 (une future table encaissements introduirait cela sans rupture). ON DELETE CASCADE comme
// compromis.bienId/acquereurId : aucune suppression de compromis n'existe dans le codebase, mais une
// ligne remuneration n'a aucun sens indépendamment de son compromis.
// Montants en CENTIMES entiers (jamais un flottant) — contrairement à compromis.prixConvenu/
// offres.montant qui sont des euros entiers : première donnée financière précise d'Atlas, divergence
// assumée. montantRemunerationConseillerCentimes NOT NULL (aucune ligne vide : si le montant n'est
// pas connu, aucune ligne n'est créée) ; montantHonorairesTotalCentimes nullable. Aucune relation
// automatique entre les deux colonnes, aucun taux implicite — seuls des montants saisis font foi.
// Pas de statut stocké : l'état prévisionnelle/associée à une vente finalisée/encaissée se déduit à
// la lecture de compromis.statut + dateEncaissementReelle (voir src/types/remuneration.ts), jamais
// une colonne dupliquée. dateEncaissementPrevue (saisie) et dateEncaissementReelle (constatée, posée
// uniquement par la transition d'encaissement dédiée, jamais à la création) suivent la même
// distinction prévue/constatée que compromis.dateActe/dateActeReelle (ADR-017). Une fois
// dateEncaissementReelle posée, la ligne est figée : plus aucune correction depuis ce chemin (une
// correction tardive relèverait de la future passe encaissements/régularisations).
// Archivage du bien/acquéreur : ne bloque jamais la correction/l'encaissement d'une rémunération sur
// un compromis déjà 'realise' (seuls les nouveaux engagements prévisionnels sur un compromis encore
// 'en_cours' sont bloqués côté Server Action) — le règlement financier d'une vente déjà conclue ne
// s'arrête pas à l'archivage du dossier commercial (voir src/actions/remuneration.ts).
// Opportunité de prise de mandat vendeur (ADR-027), en amont du cycle déjà modélisé par `biens`.
// Représente en V1 une OPPORTUNITÉ avec un contact vendeur principal — jamais une personne
// physique générique découplée de l'opportunité (un seul contact par opportunité, une seule
// opportunité par bien potentiel : voir l'unicité sur bienId ci-dessous). Plusieurs propriétaires
// sur un même bien, ou un même propriétaire avec plusieurs biens, nécessiteront une séparation
// contact <-> opportunité dans une passe ultérieure, non construite ici.
//
// Statut jamais stocké : dérivé à la lecture des jalons ci-dessous, même principe que
// biens.offreEnCoursLe/compromisSigneLe (ADR-014) — voir deriverStatutProspectVendeur,
// src/types/prospectVendeur.ts. rdvEstimationPrevuLe (planifié) et rdvEstimationRealiseLe (tenu)
// sont deux colonnes distinctes : seule la seconde fait avancer le statut, un rendez-vous
// planifié dans le futur n'est jamais un jalon commercial franchi. Les deux portent l'heure
// (timestamptz), utile aux futurs agenda/rappels/automatisations (ADR-028+).
//
// nom NOT NULL / prenom nullable : un lead peut n'être connu que par son nom, ou correspondre plus
// tard à une SCI/indivision/succession — ADR-027 ne construit pas de modèle personne
// physique/personne morale, cette seule nullabilité documente la limite. email/telephone tous
// deux nullables, sans invariant croisé : un lead de prospection terrain peut être enregistré
// avant même d'avoir une coordonnée de contact directe, Atlas n'invente jamais une donnée
// manquante ni ne bloque la création pour ce motif.
//
// adresseBienPotentiel (précise) et secteurBienPotentiel (description approximative, "quartier
// centre-ville") sont deux champs distincts, jamais confondus : seul adresseBienPotentiel peut
// préremplir biens.adresse à la conversion (voir signerMandatProspectVendeur,
// prospectVendeurRepository.ts) — un secteur flou ne devient jamais une adresse.
//
// dernierContactLe : mis à jour uniquement par une vraie interaction (ajouterNoteProspectVendeur
// pour un type != 'note_interne', ou marquerRdvEstimationRealise) — jamais par un simple jalon de
// pipeline (qualifieLe/estimationProposeeLe/mandatProposeLe/mandatSigneLe), indispensable pour que
// de futures règles déterministes de relance (ADR-028+) mesurent un vrai silence vendeur.
//
// prochaineAction/prochaineActionLe (champs simples, ADR-027 point 7) ont été retirés par ADR-028 :
// le rattachement propre bien/acquéreur/prospect vendeur des tâches est désormais porté par la
// table `taches` (prospectVendeurId). Migration immédiate lors de l'introduction de `taches`,
// aucune période de compatibilité, aucun champ de repli conservé ici.
//
// archiveLe (ADR-012) distinct de motifPerte/datePerte : perdu est un résultat commercial (entre
// dans les statistiques de conversion), archiveLe est une gestion administrative de la fiche
// (doublon, erreur de saisie) — jamais l'un pour l'autre. bienId : vraie FK (ADR-010, l'entité en
// amont est garantie réelle au moment où elle est posée), UNIQUE — une opportunité par bien, et un
// bien ne peut être le résultat que d'une seule conversion.
export const prospectsVendeurs = pgTable(
  "prospects_vendeurs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nom: text("nom").notNull(),
    prenom: text("prenom"),
    email: text("email"),
    telephone: text("telephone"),
    origineLead: text("origine_lead"),
    origineLeadDetail: text("origine_lead_detail"),
    adresseBienPotentiel: text("adresse_bien_potentiel"),
    secteurBienPotentiel: text("secteur_bien_potentiel"),
    ville: text("ville"),
    codePostal: text("code_postal"),
    typeBien: text("type_bien"),
    qualifieLe: timestamp("qualifie_le", { withTimezone: true }),
    estimationProposeeCentimes: integer("estimation_proposee_centimes"),
    estimationProposeeLe: date("estimation_proposee_le"),
    rdvEstimationPrevuLe: timestamp("rdv_estimation_prevu_le", { withTimezone: true }),
    rdvEstimationRealiseLe: timestamp("rdv_estimation_realise_le", { withTimezone: true }),
    mandatProposeLe: timestamp("mandat_propose_le", { withTimezone: true }),
    mandatSigneLe: timestamp("mandat_signe_le", { withTimezone: true }),
    bienId: uuid("bien_id").references(() => biens.id).unique(),
    motifPerte: text("motif_perte"),
    datePerte: date("date_perte"),
    dernierContactLe: timestamp("dernier_contact_le", { withTimezone: true }),
    archiveLe: timestamp("archive_le", { withTimezone: true }),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "prospects_vendeurs_estimation_positive_check",
      sql`${table.estimationProposeeCentimes} IS NULL OR ${table.estimationProposeeCentimes} > 0`
    ),
    check(
      "prospects_vendeurs_origine_lead_check",
      sql`${table.origineLead} IS NULL OR ${table.origineLead} IN ('recommandation','ancien_client','site_web','reseaux_sociaux','prospection_terrain','panneau','salon_evenement','apport_affaire','autre')`
    ),
    check(
      "prospects_vendeurs_type_bien_check",
      sql`${table.typeBien} IS NULL OR ${table.typeBien} IN ('appartement','maison','studio','loft','local_commercial')`
    ),
    check(
      "prospects_vendeurs_motif_perte_check",
      sql`${table.motifPerte} IS NULL OR ${table.motifPerte} IN ('projet_abandonne','choix_agence_concurrente','desaccord_estimation','injoignable','bien_vendu_autrement','delai_calendrier','autre')`
    ),
  ]
);

// Notes append-only sur un prospect vendeur (ADR-027), même patron que notes_bien (ADR-011) : FK
// réelle, aucun modifieLe, aucun UPDATE jamais émis. `type` distingue une vraie interaction vendeur
// d'une remarque interne — seules les valeurs != 'note_interne' font avancer
// prospectsVendeurs.dernierContactLe (voir noteProspectVendeurRepository.ajouterNoteProspectVendeur).
export const notesProspectVendeur = pgTable(
  "notes_prospect_vendeur",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectVendeurId: uuid("prospect_vendeur_id")
      .notNull()
      .references(() => prospectsVendeurs.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("note_interne"),
    contenu: text("contenu").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "notes_prospect_vendeur_type_check",
      sql`${table.type} IN ('appel','email','sms','rendez_vous','autre_interaction','note_interne')`
    ),
  ]
);

export const remuneration = pgTable(
  "remuneration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compromisId: uuid("compromis_id")
      .notNull()
      .references(() => compromis.id, { onDelete: "cascade" })
      .unique(),
    montantHonorairesTotalCentimes: integer("montant_honoraires_total_centimes"),
    montantRemunerationConseillerCentimes: integer("montant_remuneration_conseiller_centimes").notNull(),
    dateEncaissementPrevue: date("date_encaissement_prevue"),
    dateEncaissementReelle: date("date_encaissement_reelle"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }),
  },
  (table) => [
    check(
      "remuneration_montant_conseiller_positif_check",
      sql`${table.montantRemunerationConseillerCentimes} > 0`
    ),
    check(
      "remuneration_montant_honoraires_positif_check",
      sql`${table.montantHonorairesTotalCentimes} IS NULL OR ${table.montantHonorairesTotalCentimes} > 0`
    ),
  ]
);

// Tâches métier réelles (ADR-028, remplace l'ancienne table `actions` — jamais une compatibilité
// double-écriture, migration immédiate). Cibles dédiées, jamais un couple objetType/objetId
// polymorphe sans FK : l'intégrité référentielle prime sur la généricité — sept FK nullables, une
// par domaine réellement supporté aujourd'hui. Toutes ON DELETE CASCADE : aucune suppression
// n'existe pour aucune de ces sept entités dans le codebase, mais une tâche n'a aucun sens
// indépendamment de sa cible si celle-ci venait à disparaître (même rationale que
// compromis.bienId/remuneration.compromisId). Une tâche sans rattachement (tâche générale) reste
// explicitement autorisée : la contrainte ci-dessous impose "au plus une", jamais "exactement une".
// Au niveau TypeScript/UI, `CibleTache` (src/types/tache.ts) expose une union {type,id} dérivée de
// ces sept colonnes pour conserver une API générique sans renoncer à l'intégrité en base.
//
// statut jamais stocké : dérivé de termineeLe/annuleeLe à la lecture (deriverStatutTache,
// src/types/tache.ts), même principe que biens.offreEnCoursLe/compromisSigneLe (ADR-014). Les deux
// colonnes sont mutuellement exclusives par construction applicative (jamais une contrainte SQL,
// portée par la Server Action — même séparation qu'offres.statut/compromis.statut).
//
// origine ('manuelle'/'automatique') + origineCode (identifiant machine STABLE destiné à de
// futures règles automatiques — jamais du texte d'affichage, contrairement à `contexte`) préparent
// une génération automatique de tâches (relances, ADR-029+) sans en implémenter la moindre règle
// ici : aucune tâche 'automatique' n'est créée par le code actuel. Une future passe
// d'automatisation devra traiter l'idempotence/déduplication des tâches qu'elle génère (ne pas
// recréer une relance déjà ouverte pour la même cause) — non implémenté ici puisqu'aucune règle
// automatique n'existe encore : `origineCode` est le champ prévu pour cela le moment venu, pas un
// mécanisme construit par avance.
export const taches = pgTable(
  "taches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    titre: text("titre").notNull(),
    contexte: text("contexte"),
    type: text("type").notNull().default("autre"),
    priorite: text("priorite").notNull().default("normale"),
    echeance: date("echeance"),
    origine: text("origine").notNull().default("manuelle"),
    origineCode: text("origine_code"),
    bienId: uuid("bien_id").references(() => biens.id, { onDelete: "cascade" }),
    acquereurId: uuid("acquereur_id").references(() => acquereurs.id, { onDelete: "cascade" }),
    prospectVendeurId: uuid("prospect_vendeur_id").references(() => prospectsVendeurs.id, { onDelete: "cascade" }),
    visiteId: uuid("visite_id").references(() => comptesRendusVisite.id, { onDelete: "cascade" }),
    offreId: uuid("offre_id").references(() => offres.id, { onDelete: "cascade" }),
    compromisId: uuid("compromis_id").references(() => compromis.id, { onDelete: "cascade" }),
    remunerationId: uuid("remuneration_id").references(() => remuneration.id, { onDelete: "cascade" }),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    termineeLe: timestamp("terminee_le", { withTimezone: true }),
    annuleeLe: timestamp("annulee_le", { withTimezone: true }),
  },
  (table) => [
    check("taches_type_check", sql`${table.type} IN ('appel','email','message','document','relance','autre')`),
    check("taches_priorite_check", sql`${table.priorite} IN ('haute','normale','basse')`),
    check("taches_origine_check", sql`${table.origine} IN ('manuelle','automatique')`),
    // Au plus une cible : somme des sept indicatrices de présence <= 1 — jamais "exactement 1"
    // (une tâche générale sans rattachement reste valide), jamais "au moins 1".
    check(
      "taches_une_seule_cible_check",
      sql`(
        (case when ${table.bienId} is not null then 1 else 0 end) +
        (case when ${table.acquereurId} is not null then 1 else 0 end) +
        (case when ${table.prospectVendeurId} is not null then 1 else 0 end) +
        (case when ${table.visiteId} is not null then 1 else 0 end) +
        (case when ${table.offreId} is not null then 1 else 0 end) +
        (case when ${table.compromisId} is not null then 1 else 0 end) +
        (case when ${table.remunerationId} is not null then 1 else 0 end)
      ) <= 1`
    ),
  ]
);
