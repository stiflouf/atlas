import { pgTable, text, real, integer, boolean, date, timestamp, uuid, unique, uniqueIndex, check, primaryKey } from "drizzle-orm/pg-core";
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
    // Déclaratif, texte libre (ADR-029) : pas d'entité copropriete en V1 (aucun besoin de
    // mutualisation entre plusieurs biens exprimé aujourd'hui). Sert de référence pour une
    // comparaison humaine avec documentsBien.coproprieteDeclaree (anti-mauvais-dossier futur,
    // jamais automatique dans cette passe). NULL = non renseigné, jamais "pas de copropriété".
    nomCopropriete: text("nom_copropriete"),
    // Condition commerciale du mandat (ADR-029) : qui supporte les honoraires d'agence de la
    // transaction. Portée par `biens` (pas `compromis`) car c'est une caractéristique du mandat/de
    // l'annonce, connue avant toute offre ou tout compromis — poser le champ ici permet à Atlas de
    // signaler l'absence d'information dès la commercialisation, pas seulement au moment du
    // compromis, et évite toute ressaisie/duplication entre bien et compromis. NULL = non
    // renseigné ("Charge des honoraires non renseignée"), jamais une valeur par défaut inventée.
    // V1 volontairement binaire : aucun modèle de répartition réelle (montants/pourcentages par
    // partie) n'est demandé aujourd'hui, "partagee" n'est donc pas dans le vocabulaire — l'ajouter
    // sans modéliser la répartition serait un état à moitié construit.
    // Distinct de remuneration.montantRemunerationConseillerCentimes (ADR-021, part du conseiller) :
    // deux faits jamais confondus, l'un qualitatif (qui paie les honoraires de la transaction),
    // l'autre financier (combien perçoit le conseiller).
    chargeHonoraires: text("charge_honoraires"),
    // Code commune INSEE canonique (ADR-035, citycode IGN) — chaîne, jamais un entier (Corse :
    // "2A"/"2B"). Résolu automatiquement (adresse/ville/codePostal -> IGN Géoplateforme) à chaque
    // création/modification du bien, jamais calculé à la lecture ni saisi manuellement. NULL si
    // l'IGN était indisponible ou le résultat insuffisamment fiable — jamais bloquant pour
    // l'enregistrement du bien, jamais une ancienne valeur périmée conservée après un changement
    // d'adresse (la résolution est toujours refaite en entier, jamais fusionnée avec l'existant).
    // Sert uniquement au critère géographique du moteur de compatibilité (src/lib/compatibilite/) —
    // ne remplace jamais adresse/ville/codePostal, qui restent la saisie de référence affichée.
    codeInseeCommune: text("code_insee_commune"),
  },
  (table) => [
    check("biens_type_check", sql`${table.type} IN ('appartement','maison','studio','loft','local_commercial')`),
    check("biens_statut_mandat_check", sql`${table.statutMandat} IN ('actif','suspendu','expire')`),
    check(
      "biens_exterieur_check",
      sql`${table.exterieur} IS NULL OR ${table.exterieur} IN ('aucun','balcon','terrasse','jardin')`
    ),
    check(
      "biens_charge_honoraires_check",
      sql`${table.chargeHonoraires} IS NULL OR ${table.chargeHonoraires} IN ('vendeur','acquereur')`
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

// Secteurs de recherche géographique d'un acquéreur (ADR-035) — une ligne par commune/
// arrondissement recherché. codeInsee est l'identifiant canonique (citycode IGN, chaîne, jamais un
// entier : la Corse porte des codes non numériques "2A"/"2B") sur lequel porte toute comparaison de
// compatibilité géographique (src/lib/compatibilite/) ; nomCommune/codePostal ne servent qu'à
// l'affichage, jamais comparés. Une ligne n'est insérée qu'après vérification serveur fraîche du
// citycode auprès de l'IGN (verifierCommune, jamais une confiance aveugle dans trois hidden inputs
// soumis par le client). acquereurId est une vraie FK CASCADE : un acquéreur supprimé (jamais en
// pratique, archivage seulement — ADR-012) n'entraîne aucune ligne orpheline.
export const secteursRechercheAcquereur = pgTable(
  "secteurs_recherche_acquereur",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    acquereurId: uuid("acquereur_id")
      .notNull()
      .references(() => acquereurs.id, { onDelete: "cascade" }),
    codeInsee: text("code_insee").notNull(),
    nomCommune: text("nom_commune").notNull(),
    codePostal: text("code_postal").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("secteurs_recherche_acquereur_id_code_insee_unique").on(table.acquereurId, table.codeInsee)]
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
// partir de STORAGE_ROOT + cleStockage. Le FICHIER reste append-only comme notes_bien/
// comptes_rendus_visite (ADR-011/ADR-013) : aucune suppression, aucune ré-upload en V1 — mais
// depuis ADR-029, les MÉTADONNÉES de classement (colonnes ci-dessous, hors bienId/nom/
// nomFichierOriginal/cleStockage/tailleOctets/typeMime/creeLe qui décrivent le fichier lui-même)
// sont corrigibles via documentBienRepository.corrigerClassementDocumentBien : une erreur de
// classement (mauvais bien, mauvaise catégorie, mauvais rattachement) ne doit jamais être
// irréversible. modifieLe (nullable, posé uniquement par une correction) suit le même patron que
// remuneration.modifieLe (ADR-021) — pas de table de versions séparée, la valeur courante fait
// foi, aucun historique des corrections n'est demandé.
export const documentsBien = pgTable(
  "documents_bien",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Corrigible (ADR-029) : un document mal classé sur le mauvais bien (retour terrain — agents
    // mélangeant les pièces de plusieurs dossiers) doit pouvoir être réattribué sans toucher au
    // fichier physique, qui ne dépend que de cleStockage.
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
    // Vocabulaire produit Atlas (src/types/documentBien.ts, TYPES_DOCUMENT) — liste fermée mais
    // volontairement non exhaustive juridiquement, jamais une affirmation d'obligation légale.
    // NULL = non classé finement (seule `categorie` connue). typeDocumentDetail : texte libre,
    // pertinent uniquement pour typeDocument = 'autre' (même patron que origineLead/
    // origineLeadDetail, ADR-027) — jamais une seconde façon d'écrire un type déjà couvert par la
    // liste fermée.
    typeDocument: text("type_document"),
    typeDocumentDetail: text("type_document_detail"),
    // Date du document lui-même (émission/réalisation), distincte de creeLe (date d'upload dans
    // Atlas) — les deux ne coïncident quasiment jamais en pratique (un DPE réalisé il y a 3 mois
    // uploadé aujourd'hui). NULL = date du document inconnue, jamais assimilée à creeLe.
    dateDocument: date("date_document"),
    // Pertinent uniquement pour les diagnostics à durée de vie légale — NULL = validité inconnue,
    // jamais interprété comme "valide indéfiniment". Aucune durée légale n'est calculée depuis
    // cette colonne dans cette passe (ADR-029) : uniquement une date saisie manuellement.
    dateFinValidite: date("date_fin_validite"),
    // Rattachements additionnels à bienId (ADR-029), indépendants et cumulables — jamais le
    // patron "une seule cible" de `taches` (CHECK <= 1) : un document peut légitimement porter
    // bienId ET acquereurId en même temps (ex. une CNI acquéreur rattachée à la fois au dossier du
    // bien et à la personne). ON DELETE SET NULL (pas cascade, même rationale que
    // compromis.offreId, ADR-016) : un document reste consultable même si la cible d'un
    // rattachement venait à disparaître, le document est plus fondamental que ce lien. Cohérence
    // croisée (compromisId doit appartenir à bienId, acquereurId cohérent avec le compromis,
    // prospectVendeurId cohérent avec le bien converti) portée par
    // src/lib/documents/coherenceRattachementDocument.ts (validerCoherenceRattachementsDocument),
    // appelée par les Server Actions — aucune de ces règles n'est
    // exprimable en CHECK SQL (comparaisons inter-tables), même séparation que
    // offres.statut/compromis.offreId (ADR-015/016).
    compromisId: uuid("compromis_id").references(() => compromis.id, { onDelete: "set null" }),
    acquereurId: uuid("acquereur_id").references(() => acquereurs.id, { onDelete: "set null" }),
    prospectVendeurId: uuid("prospect_vendeur_id").references(() => prospectsVendeurs.id, {
      onDelete: "set null",
    }),
    // Déclaratif, texte libre (ADR-029) : ce que le document prétend concerner, jamais extrait
    // automatiquement (aucun OCR/LLM dans cette passe). Terrain de comparaison humaine future avec
    // biens.nomCopropriete/biens.adresse (anti-mauvais-dossier — retour terrain : documents reçus
    // pour la mauvaise copropriété).
    coproprieteDeclaree: text("copropriete_declaree"),
    adresseDeclaree: text("adresse_declaree"),
    // Provenance texte libre (ADR-029) : d'où vient le document (agent, vendeur, acquéreur,
    // notaire, syndic...) — pas de vocabulaire fermé, l'usage réel n'est pas encore assez connu
    // pour figer une liste.
    provenance: text("provenance"),
    // État de VÉRIFICATION DU CLASSEMENT (ADR-029) — distinct de l'état de contrôle d'une exigence
    // de checklist (present/manquant/a_verifier/non_applicable/perime/incoherent), qui reste
    // entièrement dérivé et jamais stocké (src/lib/documents/checklistDossier.ts). Cette colonne ne
    // porte qu'un jugement du conseiller sur le rattachement/classement lui-même : 'rejete' signale
    // un classement explicitement incorrect (le moteur de checklist en dérive alors 'incoherent'
    // pour l'exigence concernée) — jamais déduit automatiquement.
    etatVerification: text("etat_verification").notNull().default("non_verifie"),
    modifieLe: timestamp("modifie_le", { withTimezone: true }),
  },
  (table) => [
    check(
      "documents_bien_categorie_check",
      sql`${table.categorie} IN ('mandat','diagnostic','copropriete','technique','commercial','compromis','autre')`
    ),
    check(
      "documents_bien_type_document_check",
      sql`${table.typeDocument} IS NULL OR ${table.typeDocument} IN (
        'cni','justificatif_domicile','rib',
        'titre_propriete','plan','taxe_fonciere',
        'dpe','amiante','plomb','electricite','gaz','carrez','termites','erp','assainissement',
        'reglement_copropriete','edd','pv_ag','pre_etat_date','fiche_synthetique','carnet_entretien','procedures_syndic',
        'mandat','offre_achat','compromis','avenant',
        'attestation_financement','offre_pret',
        'courrier_notaire','projet_acte',
        'autre'
      )`
    ),
    check(
      "documents_bien_etat_verification_check",
      sql`${table.etatVerification} IN ('non_verifie','confirme','a_verifier','rejete')`
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

// Envoi Gmail réel (ADR-031-bis) : audit TECHNIQUE d'une tentative d'envoi, jamais un fait CRM
// (voir notes_prospect_vendeur, ADR-027, pour le fait CRM correspondant, posé séparément
// uniquement après succès confirmé). `id` n'est PAS `defaultRandom()` : fourni par l'appelant
// (généré côté client à l'entrée de l'écran de confirmation) et utilisé comme CLÉ D'IDEMPOTENCE —
// `INSERT ... ON CONFLICT (id) DO NOTHING` empêche tout double envoi sur double clic/retry/replay,
// jamais une fenêtre de temps arbitraire. `contenuHash` (SHA-256 de destinataire+objet+corps) est
// une donnée technique de diagnostic uniquement, jamais utilisée pour bloquer un envoi — le corps
// complet n'est lui-même jamais persisté ici (seule sa mention resterait dans une note ADR-027,
// courte, jamais un copier-coller intégral).
//
// Trois timestamps terminaux mutuellement exclusifs PAR CONSTRUCTION APPLICATIVE (gel concurrent
// via `WHERE ... IS NULL`, même patron que taches.termineeLe/annuleeLe ADR-028), jamais un CHECK
// SQL. `incertainLe` est distinct d'`echoueLe` : posé uniquement quand une rupture réseau/timeout
// survient APRÈS le déclenchement de l'appel Gmail — on ne sait alors PAS si l'email a été
// réellement envoyé, jamais assimilé à un échec net (qui suppose une réponse HTTP effectivement
// reçue de Google). Ni l'un ni l'autre posé = `en_cours` (transitoire, la durée d'une seule
// requête serveur synchrone).
export const envoisEmail = pgTable(
  "envois_email",
  {
    id: uuid("id").primaryKey(),
    destinataireEmail: text("destinataire_email").notNull(),
    objet: text("objet").notNull(),
    contenuHash: text("contenu_hash").notNull(),
    fournisseur: text("fournisseur").notNull().default("gmail"),
    bienId: uuid("bien_id").references(() => biens.id, { onDelete: "set null" }),
    tacheId: uuid("tache_id").references(() => taches.id, { onDelete: "set null" }),
    origineIntention: text("origine_intention"),
    gmailMessageId: text("gmail_message_id"),
    demarreLe: timestamp("demarre_le", { withTimezone: true }).notNull().defaultNow(),
    reussiLe: timestamp("reussi_le", { withTimezone: true }),
    echoueLe: timestamp("echoue_le", { withTimezone: true }),
    incertainLe: timestamp("incertain_le", { withTimezone: true }),
    // Court libellé technique catégorisé — jamais un dump brut de l'erreur Google, jamais un
    // token, jamais le corps du message.
    erreurTechnique: text("erreur_technique"),
  },
  (table) => [
    check("envois_email_fournisseur_check", sql`${table.fournisseur} IN ('gmail')`),
    check(
      "envois_email_origine_intention_check",
      sql`${table.origineIntention} IS NULL OR ${table.origineIntention} IN (
        'relance_prospect_vendeur','suivi_rdv_estimation','suivi_acquereur','suivi_visite',
        'demande_document_manquant','relance_piece_a_verifier','message_compromis','message_notaire'
      )`
    ),
  ]
);

// Fait métier atomique, append-only (ADR-032) : distinct d'une alerte (ADR-026, jamais persistée,
// un jugement dérivé sur l'état courant) et d'une tâche (ADR-028, une action à faire). Un
// événement décrit uniquement "ceci est réellement survenu à cet instant" — jamais une décision
// ni une action. Cible dédiée par colonne FK (même discipline que `taches`, ADR-028) : jamais un
// couple `objetType`/`objetId` polymorphe. Contrairement à `taches` (`<= 1`, cible optionnelle),
// ici EXACTEMENT une colonne est renseignée : un événement a toujours une source.
//
// Aucun `onDelete` sur les FK vers les entités source (ni CASCADE ni SET NULL) — même précédent
// que `prospectsVendeurs.bienId` : NO ACTION par défaut. Supprimer/archiver une donnée métier ne
// doit jamais effacer silencieusement la trace d'un événement déjà survenu (aucune suppression
// n'existe aujourd'hui pour ces entités de toute façon, ADR-013/027/028).
//
// Index uniques PARTIELS (un par cible) : empêchent qu'un double submit sur la Server Action
// d'origine crée deux lignes représentant le MÊME fait (ex. deux événements `visite_realisee`
// pour le même `compte_rendu_visite_id`) — protection indépendante de
// `executions_automatisation.UNIQUE(regle_code, evenement_id)`, qui protège seulement le rejeu
// d'un événement déjà existant, pas la création du doublon lui-même.
// `ancreCycle` (ADR-033) : NULL pour les quatre types ponctuels d'ADR-032, obligatoire pour
// 'inactivite_prospect_vendeur' — porte la valeur de dernierContactLe (ou creeLe en repli) qui a
// servi de base au calcul du seuil franchi. C'est elle, pas prospectVendeurId seul, qui distingue
// deux cycles de silence successifs pour le même prospect (voir les deux index prospect ci-dessous).
// `bienId`/`acquereurId`/`cycleCompatibilite` (ADR-036) : couple discriminé au même titre que les
// trois colonnes-cible ponctuelles ci-dessus, jamais un couple `{type, id}` générique — réservés au
// seul type 'compatibilite_bien_acquereur_devenue_compatible'. Toujours posés ENSEMBLE (jamais l'un
// sans l'autre, voir le CHECK dédié) : la paire (bien, acquéreur) forme UNE seule cible logique,
// pas deux. `cycleCompatibilite` (entier, jamais un timestamp comme `ancreCycle` : aucun ancrage
// métier externe n'existe pour ce type, seulement un compteur de retours à compatible) porte la
// même fonction d'idempotence de cycle que `ancreCycle` pour 'inactivite_prospect_vendeur'.
export const evenementsMetier = pgTable(
  "evenements_metier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    typeEvenement: text("type_evenement").notNull(),
    compteRenduVisiteId: uuid("compte_rendu_visite_id").references(() => comptesRendusVisite.id),
    prospectVendeurId: uuid("prospect_vendeur_id").references(() => prospectsVendeurs.id),
    compromisId: uuid("compromis_id").references(() => compromis.id),
    ancreCycle: timestamp("ancre_cycle", { withTimezone: true }),
    bienId: uuid("bien_id").references(() => biens.id),
    acquereurId: uuid("acquereur_id").references(() => acquereurs.id),
    cycleCompatibilite: integer("cycle_compatibilite"),
    survenuLe: timestamp("survenu_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "evenements_metier_type_check",
      sql`${table.typeEvenement} IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible'
      )`
    ),
    // Étendu par ADR-036 : le couple (bien_id, acquereur_id), posé ENSEMBLE, compte désormais comme
    // une 4e cible logique possible — jamais une 5e/6e colonne comptée séparément (sinon un
    // événement de compatibilité, qui pose les deux, violerait "exactement une cible"). Le second
    // CHECK ci-dessous interdit indépendamment qu'une seule des deux colonnes soit posée seule.
    check(
      "evenements_metier_une_seule_cible_check",
      sql`(
        (case when ${table.compteRenduVisiteId} is not null then 1 else 0 end) +
        (case when ${table.prospectVendeurId} is not null then 1 else 0 end) +
        (case when ${table.compromisId} is not null then 1 else 0 end) +
        (case when ${table.bienId} is not null and ${table.acquereurId} is not null then 1 else 0 end)
      ) = 1`
    ),
    check(
      "evenements_metier_bien_acquereur_ensemble_check",
      sql`(${table.bienId} IS NOT NULL) = (${table.acquereurId} IS NOT NULL)`
    ),
    uniqueIndex("evenements_metier_visite_unique")
      .on(table.typeEvenement, table.compteRenduVisiteId)
      .where(sql`${table.compteRenduVisiteId} IS NOT NULL`),
    // Réservé aux types PONCTUELS sur prospectVendeurId (rdv_estimation_realise, mandat_signe) —
    // exclut explicitement 'inactivite_prospect_vendeur' (ADR-033), cyclique par nature : sans
    // cette exclusion, cet index bloquerait à vie toute deuxième occurrence de silence pour le
    // même prospect après un nouveau contact.
    uniqueIndex("evenements_metier_prospect_vendeur_unique")
      .on(table.typeEvenement, table.prospectVendeurId)
      .where(sql`${table.prospectVendeurId} IS NOT NULL AND ${table.typeEvenement} <> 'inactivite_prospect_vendeur'`),
    // Dédié au type cyclique : une occurrence par (prospect, ancre de cycle) — un nouveau contact
    // change l'ancre et ouvre donc une nouvelle occurrence possible ; la même ancre rejouée
    // (double submit du scan, scans concurrents) ne duplique jamais.
    uniqueIndex("evenements_metier_inactivite_prospect_vendeur_unique")
      .on(table.typeEvenement, table.prospectVendeurId, table.ancreCycle)
      .where(sql`${table.typeEvenement} = 'inactivite_prospect_vendeur'`),
    uniqueIndex("evenements_metier_compromis_unique")
      .on(table.typeEvenement, table.compromisId)
      .where(sql`${table.compromisId} IS NOT NULL`),
    // Dédié au type cyclique de compatibilité (ADR-036), même principe que l'index ci-dessus pour
    // 'inactivite_prospect_vendeur' : une occurrence par (bien, acquéreur, cycle) — le même cycle
    // rejoué (retry exact, deux synchronisations concurrentes de la même paire) ne duplique jamais ;
    // un retour ultérieur à compatible incrémente le cycle et ouvre donc une nouvelle occurrence.
    uniqueIndex("evenements_metier_compatibilite_unique")
      .on(table.typeEvenement, table.bienId, table.acquereurId, table.cycleCompatibilite)
      .where(sql`${table.typeEvenement} = 'compatibilite_bien_acquereur_devenue_compatible'`),
  ]
);

// Snapshot d'exécution d'une règle pour un événement précis (ADR-032). Créée dans LA MÊME
// transaction que l'événement et la mutation métier déclenchante (jamais après coup) : la
// décision "cette règle devait-elle réagir ?" est figée au moment où l'événement survient, à
// l'activation alors en vigueur — activer une règle plus tard ne traite jamais rétroactivement
// les événements passés (aucune ligne n'existe pour eux).
//
// `UNIQUE(regle_code, evenement_id)` est LA clé d'idempotence d'exécution — jamais
// `taches.origineCode` seul (insuffisant : une même règle s'exécute pour plusieurs objets).
//
// Trois états dérivés de deux timestamps terminaux (jamais un troisième "incertain" : contrairement
// à un envoi Gmail, créer une tâche est une écriture Postgres locale, sans ambiguïté réseau) :
// `reussieLe` posé -> "reussie" ; `echoueeLe` posé -> "echouee" ; ni l'un ni l'autre -> "a_traiter"
// (état normal juste après le COMMIT de la transaction métier, avant le traitement synchrone qui
// suit immédiatement — mais aussi l'état laissé si le process s'arrête entre les deux : jamais
// perdu, jamais confondu avec "traité", voir deriverEtatExecutionAutomatisation).
//
// `tacheId` SET NULL (comme `taches.*Id` vers leurs cibles) : l'audit peut survivre même si la
// tâche produite venait un jour à disparaître (aucune suppression n'existe aujourd'hui).
export const executionsAutomatisation = pgTable(
  "executions_automatisation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regleCode: text("regle_code").notNull(),
    evenementId: uuid("evenement_id")
      .notNull()
      .references(() => evenementsMetier.id),
    tacheId: uuid("tache_id").references(() => taches.id, { onDelete: "set null" }),
    demarreeLe: timestamp("demarree_le", { withTimezone: true }).notNull().defaultNow(),
    reussieLe: timestamp("reussie_le", { withTimezone: true }),
    echoueeLe: timestamp("echouee_le", { withTimezone: true }),
    erreurTechnique: text("erreur_technique"),
    // ADR-038 — observabilité/plafond de la reprise après crash, JAMAIS la source de la garantie
    // d'idempotence (portée par UNIQUE(regle_code, evenement_id) + la transaction unique effet+
    // reussieLe déjà existante, voir traiterUneExecution, moteur.ts). Un hard crash peut empêcher
    // l'écriture de cet incrément lui-même (il vit dans sa propre petite transaction, séparée de la
    // transaction de traitement) — ce compteur reste donc une estimation observable des tentatives
    // effectivement enregistrées, jamais une preuve mathématique exhaustive.
    nombreTentatives: integer("nombre_tentatives").notNull().default(0),
    derniereTentativeLe: timestamp("derniere_tentative_le", { withTimezone: true }),
  },
  (table) => [
    check(
      "executions_automatisation_regle_code_check",
      sql`${table.regleCode} IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur'
      )`
    ),
    check("executions_automatisation_nombre_tentatives_positif_check", sql`${table.nombreTentatives} >= 0`),
    unique("executions_automatisation_regle_evenement_unique").on(table.regleCode, table.evenementId),
  ]
);

// Activation mono-conseiller par règle (ADR-032). Absence de ligne = INACTIF (jamais actif par
// défaut) : une règle ajoutée au catalogue TypeScript n'entre jamais en production silencieusement
// du seul fait d'une migration/déploiement — seule une ligne explicite `active = true` (posée ici
// par un geste délibéré, humain ou de seed documenté) fait réagir le moteur. Bascule visible et
// explicite depuis /automatisations.
export const configurationsAutomatisation = pgTable(
  "configurations_automatisation",
  {
    regleCode: text("regle_code").primaryKey(),
    active: boolean("active").notNull().default(false),
    // Paramètre produit explicite (ADR-033), pas une constante cachée — n'a de sens que pour
    // 'inactivite_prospect_vendeur' aujourd'hui, NULL pour les autres règles ET par défaut : une
    // règle qui a besoin d'un seuil ne peut jamais être activée tant qu'il n'est pas renseigné
    // (garde applicative dans la Server Action, pas un CHECK croisé avec `active` ici — cohérent
    // avec ADR-007, la validation métier vit dans la Server Action, pas dans le schéma).
    seuilJoursInactivite: integer("seuil_jours_inactivite"),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "configurations_automatisation_regle_code_check",
      sql`${table.regleCode} IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur'
      )`
    ),
    check(
      "configurations_automatisation_seuil_positif_check",
      sql`${table.seuilJoursInactivite} IS NULL OR ${table.seuilJoursInactivite} > 0`
    ),
  ]
);

// Journal technique des passages du scanner temporel (ADR-033) — mutation contrôlée, pas
// append-only strict : une ligne est insérée au DÉMARRAGE (demarreLe) puis complétée à la FIN
// (termineLe + compteurs, ou erreurTechnique) par runScanAutomatisationRepository.ts. Un run resté
// sans termineLe (crash pendant le scan) reste honnêtement visible comme tel — voir
// deriverEtatRunScanAutomatisation (types/automatisation.ts). Aucune donnée personnelle : jamais
// un identifiant de prospect ni de bien, seulement des compteurs agrégés.
export const runsScanAutomatisation = pgTable(
  "runs_scan_automatisation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regleCode: text("regle_code").notNull(),
    demarreLe: timestamp("demarre_le", { withTimezone: true }).notNull().defaultNow(),
    termineLe: timestamp("termine_le", { withTimezone: true }),
    nombreCandidats: integer("nombre_candidats"),
    nombreOccurrencesCreees: integer("nombre_occurrences_creees"),
    erreurTechnique: text("erreur_technique"),
  },
  (table) => [
    // 'nouveau_match_bien_acquereur' (ADR-037) volontairement absent : cette règle ne réagit qu'à
    // un événement direct, jamais à un scan temporel — aucune ligne de ce journal ne la concernera
    // jamais.
    check(
      "runs_scan_automatisation_regle_code_check",
      sql`${table.regleCode} IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur'
      )`
    ),
  ]
);

// Mémoire technique de dernière observation par paire (ADR-036) — sert UNIQUEMENT à détecter une
// transition, jamais à afficher ou décider qu'une paire est compatible : la source de vérité du
// matching reste exclusivement evaluerCompatibilite() (src/lib/compatibilite/), relue à chaque
// affichage. Clé logique = clé primaire composite (bienId, acquereurId), même précédent que
// configurations_automatisation (regleCode en PK directe) — pas d'UUID de substitution, il n'existe
// pas de second axe d'identité pour une paire.
//
// `dernierStatut` reflète la dernière sortie honnête d'evaluerCompatibilite() — jamais détourné
// pour représenter autre chose (l'archivage, notamment, ne le touche jamais).
// `dansPerimetreActif` est un axe TECHNIQUE orthogonal, jamais un quatrième statut ADR-034 : faux
// uniquement lorsque le bien ou l'acquéreur de la paire est archivé. La transition vers "nouveau
// match" se lit sur la conjonction des deux : dans_perimetre_actif ET dernier_statut = 'compatible'
// (voir src/lib/compatibilite/synchronisation.ts).
// `cycleCompatibilite` : compteur (jamais un timestamp, aucun ancrage métier externe n'existe ici)
// incrémenté uniquement au moment où cette conjonction passe de faux à vrai — porte la même clé
// d'idempotence d'événement que `ancreCycle` pour 'inactivite_prospect_vendeur' (ADR-033), voir
// evenements_metier.cycle_compatibilite.
// Pas de CASCADE sur les deux FK : ni biens ni acquereurs ne sont jamais supprimés physiquement
// dans ce produit (archivage seulement, ADR-012) — NO ACTION (défaut Drizzle) suffit.
export const compatibilitesBienAcquereurEtat = pgTable(
  "compatibilites_bien_acquereur_etat",
  {
    bienId: uuid("bien_id")
      .notNull()
      .references(() => biens.id),
    acquereurId: uuid("acquereur_id")
      .notNull()
      .references(() => acquereurs.id),
    dernierStatut: text("dernier_statut").notNull(),
    dansPerimetreActif: boolean("dans_perimetre_actif").notNull().default(true),
    cycleCompatibilite: integer("cycle_compatibilite").notNull().default(0),
    observeLe: timestamp("observe_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.bienId, table.acquereurId] }),
    check(
      "compatibilites_bien_acquereur_etat_statut_check",
      sql`${table.dernierStatut} IN ('compatible','incompatible','a_verifier')`
    ),
    check("compatibilites_bien_acquereur_etat_cycle_positif_check", sql`${table.cycleCompatibilite} >= 0`),
  ]
);

// Handoff durable de resynchronisation (ADR-036) — garantit qu'une mutation susceptible de changer
// des compatibilités ne peut jamais être perdue entre son commit et le traitement effectif : la
// ligne est insérée DANS LA MÊME TRANSACTION que la mutation source (jamais après coup), donc soit
// les deux commitent ensemble, soit ni l'une ni l'autre. Traitée normalement de façon synchrone
// juste après le commit (même requête, aucun worker) ; le filet de sécurité pour un crash exactement
// entre les deux est le balayage protégé (/api/compatibilite/scan), même patron que le scan
// temporel ADR-033.
//
// File d'attente, PAS un registre de faits : contrairement à evenements_metier, un doublon ici est
// inoffensif (retraiter deux fois la même source est un no-op idempotent en aval) — aucune
// contrainte UNIQUE stricte n'est donc nécessaire. Deux index partiels (ci-dessous) activent
// toutefois un coalescing optionnel : tant qu'une ligne pour une source donnée reste non traitée,
// une nouvelle demande pour la MÊME source met à jour cette ligne (`ON CONFLICT ... DO UPDATE`,
// voir resynchronisationRepository.ts) plutôt que d'en empiler une nouvelle — sans jamais risquer de
// perdre une demande concurrente : dès qu'une ligne est marquée traitée, elle sort du prédicat
// partiel et une demande arrivée entre-temps crée naturellement une nouvelle ligne plutôt que
// d'entrer en conflit avec une ligne déjà verrouillée par le traitement en cours.
//
// Discriminée par source, même principe que evenements_metier (bienId XOR acquereurId, jamais un
// couple générique {type, id}) — le CHECK impose exactement une des deux.
export const compatibilitesARessynchroniser = pgTable(
  "compatibilites_a_resynchroniser",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bienId: uuid("bien_id").references(() => biens.id),
    acquereurId: uuid("acquereur_id").references(() => acquereurs.id),
    demandeeLe: timestamp("demandee_le", { withTimezone: true }).notNull().defaultNow(),
    // NULL = reste à traiter (jamais tenté, ou tentative précédente en échec — voir
    // derniereErreur). Non-NULL = traitement terminé sans exception pour toutes les paires
    // concernées. Contrairement à executions_automatisation.echoueeLe (terminal, une décision
    // métier), un échec ici n'est jamais terminal : la ligne reste éligible au retraitement tant
    // qu'elle n'a pas explicitement réussi — la correction prime, jamais de perte silencieuse.
    traiteeLe: timestamp("traitee_le", { withTimezone: true }),
    derniereTentativeLe: timestamp("derniere_tentative_le", { withTimezone: true }),
    derniereErreur: text("derniere_erreur"),
  },
  (table) => [
    check(
      "compatibilites_a_resynchroniser_une_seule_source_check",
      sql`(
        (case when ${table.bienId} is not null then 1 else 0 end) +
        (case when ${table.acquereurId} is not null then 1 else 0 end)
      ) = 1`
    ),
    uniqueIndex("compatibilites_a_resynchroniser_bien_en_attente_unique")
      .on(table.bienId)
      .where(sql`${table.bienId} IS NOT NULL AND ${table.traiteeLe} IS NULL`),
    uniqueIndex("compatibilites_a_resynchroniser_acquereur_en_attente_unique")
      .on(table.acquereurId)
      .where(sql`${table.acquereurId} IS NOT NULL AND ${table.traiteeLe} IS NULL`),
  ]
);
