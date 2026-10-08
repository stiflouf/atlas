import type { BaseLegale } from "./basesLegales";
import type { TypePersonneConcernee } from "./personnesConcernees";
import { POLITIQUES_CONSERVATION_V1, RETENTION_ENFORCEMENT_V1_LIVRE, politiquesConservationIndecises } from "./conservation";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — SOURCE DE VÉRITÉ VERSIONNÉE des décisions
// structurelles de confidentialité.
//
// POURQUOI EN CODE, ET VERSIONNÉ. Le dépôt a déjà démontré ce patron sur un texte à portée
// juridique : `bonVisite/templateBonVisite.ts` versionne le texte du bon (`domiora-v1`,
// `domiora-v2`), fige le texte substitué dans un snapshot à la signature, et sert une source unique
// à l'écran comme au PDF — ce qui rend démontrable l'égalité « texte présenté = texte accepté =
// texte imprimé ». Une notice de confidentialité a exactement le même besoin : savoir, pour une
// personne informée à une date donnée, ce qu'on lui a dit. Le versionnement en code le permet sans
// table ni migration.
//
// CE QUE CE FICHIER NE FAIT PAS. Il ne publie rien. Il décrit des décisions ; leur remise aux
// personnes concernées est un lot distinct (PRIVACY_NOTICE_DELIVERY_V1).
export const PRIVACY_NOTICE_VERSION = "domiora-privacy-v1";

// Modèle de responsabilité pour les traitements métier (ADR-065 §1). Le workspace — conseiller en
// EI, agence, autre structure professionnelle — détermine les finalités et les moyens.
//
// DOMIORA n'est pas écrit comme responsable du traitement métier. Ce n'est pas une prudence
// rédactionnelle : aucune entité juridique DOMIORA n'est modélisée, et `branding.ts` indique que le
// nom produit est « encore en cours de sécurisation juridique ».
export const CONTROLLER_MODEL = "WORKSPACE_LEGAL_CONTROLLER" as const;

// ─────────────────────────────── FINALITÉS ───────────────────────────────

// UNE finalité, UNE base principale. C'est la règle qui structure tout ce fichier.
//
// Lorsqu'un même domaine relève de deux bases selon le scénario, il est SCINDÉ en deux finalités
// distinctes plutôt que doté de deux bases — « traiter une demande entrante » et « prospecter
// sortant » ne sont pas la même finalité sous deux régimes, ce sont deux finalités. Une finalité
// portant deux bases serait indistincte, donc indéfendable.
export interface FinaliteTraitement {
  readonly cle: string;
  readonly libelle: string;
  readonly baseLegale: BaseLegale;
  readonly personnes: readonly TypePersonneConcernee[];
  // Où la finalité est OBSERVABLE dans le produit. Pas de finalité déclarative : chacune est
  // rattachée à du code ou à des tables qui existent.
  readonly preuveProduit: readonly string[];
  // Renseigné uniquement pour LEGITIMATE_INTEREST : clé vers `interetLegitime.ts`.
  readonly interetLegitimeCle?: string;
  // Renseigné uniquement pour LEGAL_OBLIGATION : la sous-finalité précise visée. Jamais « obligation
  // légale » seule — c'est la garde de la DECISION_2 B.
  readonly sousFinaliteObligationLegale?: string;
  readonly politiqueConservationCle: string;
}

export const FINALITES_V1: readonly FinaliteTraitement[] = Object.freeze([
  Object.freeze({
    cle: "DEMANDE_ENTRANTE_ET_PROJET_ACQUEREUR",
    libelle:
      "Traiter une demande émanant de la personne, qualifier son projet d'acquisition et organiser les visites correspondantes",
    baseLegale: "CONTRACT_OR_PRECONTRACTUAL",
    personnes: Object.freeze<TypePersonneConcernee[]>(["ACQUEREUR", "CONTACT"]),
    preuveProduit: Object.freeze([
      "acquereurs",
      "projets_acquereur",
      "secteurs_recherche_acquereur",
      "visites",
      "src/app/clients/nouveau",
      "src/app/visites/nouvelle",
    ]),
    politiqueConservationCle: "ACTIVE_CLIENT_OR_PROJECT_DATA",
  }),
  Object.freeze({
    cle: "MANDAT_ET_TRANSACTION",
    libelle: "Gérer le mandat, le bien confié et la transaction jusqu'à son terme",
    baseLegale: "CONTRACT_OR_PRECONTRACTUAL",
    personnes: Object.freeze<TypePersonneConcernee[]>(["VENDEUR", "ACQUEREUR", "CONTACT"]),
    preuveProduit: Object.freeze(["mandats", "biens", "parties_mandat", "offres", "compromis"]),
    politiqueConservationCle: "ACTIVE_CLIENT_OR_PROJECT_DATA",
  }),
  Object.freeze({
    cle: "TRANSMISSION_DOSSIER_NOTAIRE",
    libelle: "Transmettre à l'étude notariale les pièces du dossier nécessaires à l'acte",
    baseLegale: "LEGAL_OBLIGATION",
    personnes: Object.freeze<TypePersonneConcernee[]>(["VENDEUR", "ACQUEREUR"]),
    preuveProduit: Object.freeze(["transmissions_dossier_notaire", "src/lib/documents/packNotaire.ts"]),
    // Sous-finalité NOMMÉE, et volontairement étroite : la constitution du dossier de l'acte
    // authentique. Elle ne s'étend pas au reste du CRM, et la qualification exacte du texte
    // applicable reste à valider juridiquement (ADR-065 §4).
    sousFinaliteObligationLegale:
      "Constitution et transmission du dossier nécessaire à l'établissement de l'acte authentique par le notaire. Le texte précis applicable reste à confirmer par un juriste avant publication de la notice.",
    politiqueConservationCle: "TRANSACTION_DOCUMENTS",
  }),
  Object.freeze({
    cle: "HISTORIQUE_RELATIONNEL_ET_SUIVI",
    libelle:
      "Conserver l'historique de la relation, organiser les tâches et les relances de service nécessaires au suivi",
    baseLegale: "LEGITIMATE_INTEREST",
    personnes: Object.freeze<TypePersonneConcernee[]>(["CONTACT", "ACQUEREUR", "VENDEUR", "PROSPECT_VENDEUR"]),
    preuveProduit: Object.freeze(["interactions", "taches", "notes_bien", "notes_prospect_vendeur", "comptes_rendus_visite"]),
    interetLegitimeCle: "CRM_RELATIONSHIP",
    politiqueConservationCle: "FREE_TEXT_NOTES",
  }),
  Object.freeze({
    cle: "BON_VISITE_PREUVE_INTERVENTION",
    libelle:
      "Constater la réalisation d'une visite et l'intervention du professionnel dans la présentation du bien",
    // DECISION_2 D. Ni CONSENT (la case du formulaire est une confirmation de signature de
    // document, pas un consentement au traitement), ni LEGAL_OBLIGATION (aucun texte n'impose le
    // bon de visite — l'écrire serait inventer une obligation).
    baseLegale: "LEGITIMATE_INTEREST",
    personnes: Object.freeze<TypePersonneConcernee[]>(["VISITEUR"]),
    preuveProduit: Object.freeze([
      "bons_visite",
      "signatures_bon_visite",
      "src/lib/bonVisite/templateBonVisite.ts",
      "src/lib/bonVisite/pdfBonVisite.ts",
    ]),
    interetLegitimeCle: "BON_VISITE_EVIDENCE",
    politiqueConservationCle: "SIGNED_VISIT_FORM",
  }),
  Object.freeze({
    cle: "COMMUNICATIONS_DE_SERVICE",
    libelle:
      "Adresser les communications nécessaires au traitement d'une demande, d'une visite, d'un mandat ou d'une transaction",
    // DECISION_2 E : une communication de service suit la base de la finalité métier qu'elle sert.
    // Gmail n'apparaît pas ici et n'est pas une finalité : c'est un MOYEN TECHNIQUE, qui figure
    // parmi les prestataires.
    baseLegale: "CONTRACT_OR_PRECONTRACTUAL",
    personnes: Object.freeze<TypePersonneConcernee[]>(["CONTACT", "ACQUEREUR", "VENDEUR"]),
    preuveProduit: Object.freeze(["envois_email", "src/lib/google/gmailClient.ts", "src/app/communications/nouveau"]),
    politiqueConservationCle: "ACTIVE_CLIENT_OR_PROJECT_DATA",
  }),
  Object.freeze({
    cle: "ACCES_AU_SERVICE",
    libelle: "Donner accès au service à l'utilisateur qui le demande et rattacher son périmètre de travail",
    baseLegale: "CONTRACT_OR_PRECONTRACTUAL",
    personnes: Object.freeze<TypePersonneConcernee[]>(["UTILISATEUR"]),
    preuveProduit: Object.freeze([
      "src/lib/auth/sessionAtlas.ts",
      "src/lib/auth/allowlist.ts",
      "workspace_membres",
    ]),
    politiqueConservationCle: "SESSION",
  }),
  Object.freeze({
    cle: "SECURITE_DU_SERVICE",
    libelle: "Protéger l'accès au service et les données qu'il contient",
    baseLegale: "LEGITIMATE_INTEREST",
    personnes: Object.freeze<TypePersonneConcernee[]>(["UTILISATEUR"]),
    preuveProduit: Object.freeze(["src/proxy.ts", "src/lib/auth/exigerSessionAtlasRoute.ts"]),
    interetLegitimeCle: "SECURITY",
    politiqueConservationCle: "OIDC_STATE",
  }),
  Object.freeze({
    cle: "CONNECTEURS_GOOGLE_CONSEILLER",
    libelle:
      "Accéder à l'agenda et envoyer des messages depuis le compte Google du conseiller, pour les fonctions qu'il a demandées",
    baseLegale: "CONTRACT_OR_PRECONTRACTUAL",
    personnes: Object.freeze<TypePersonneConcernee[]>(["UTILISATEUR", "CONSEILLER"]),
    preuveProduit: Object.freeze([
      "connexions_google",
      "src/lib/google/calendarClient.ts",
      "src/lib/google/gmailClient.ts",
    ]),
    politiqueConservationCle: "GOOGLE_CONNECTION",
  }),
  Object.freeze({
    cle: "DONNEES_TIERS_INCIDENTES_AGENDA",
    libelle:
      "Rapprocher un événement d'agenda du dossier métier correspondant, y compris lorsque cet événement mentionne des tiers",
    // SCINDÉE de la précédente, et pas par commodité : la personne concernée n'est pas la même, elle
    // n'a pas demandé le service, et c'est elle que l'information Article 14 visera.
    baseLegale: "LEGITIMATE_INTEREST",
    personnes: Object.freeze<TypePersonneConcernee[]>(["TIERS_INCIDENT"]),
    preuveProduit: Object.freeze(["memoire_contextuelle", "src/lib/google/calendarClient.ts"]),
    interetLegitimeCle: "THIRD_PARTY_CALENDAR_DATA",
    politiqueConservationCle: "ACTIVE_CLIENT_OR_PROJECT_DATA",
  }),
  Object.freeze({
    cle: "FISCALITE_ET_REMUNERATION_CONSEILLER",
    libelle:
      "Calculer la rémunération du conseiller et ses projections fiscales, fonctionnalité qu'il demande pour lui-même",
    baseLegale: "CONTRACT_OR_PRECONTRACTUAL",
    // La personne concernée est le CONSEILLER, et les données touchent son foyer (revenu fiscal de
    // référence, nombre de parts). Elles ne deviennent pas des données du workspace du seul fait
    // qu'un second membre le rejoindrait — voir ADR-065 §9, chantier séparé.
    personnes: Object.freeze<TypePersonneConcernee[]>(["CONSEILLER"]),
    preuveProduit: Object.freeze(["dossier_fiscal", "profil_fiscal", "rfr_foyer", "remuneration"]),
    politiqueConservationCle: "ACTIVE_CLIENT_OR_PROJECT_DATA",
  }),
]);

// ─────────────────── PROSPECTION COMMERCIALE ÉLECTRONIQUE B2C ───────────────────

// DECISION_2 F. Ce n'est PAS une finalité de `FINALITES_V1`, et son absence de cette liste est le
// fait le plus important de ce fichier : la prospection commerciale électronique vers un
// particulier n'est pas un traitement que ce produit sait fonder aujourd'hui.
//
// Elle exigerait un consentement préalable spécifique, démontrable, sauf exception juridique
// applicable et elle-même démontrée. Le produit ne possède aujourd'hui aucun `marketing_consent`,
// aucun `opt_in`, aucun `consent_at`, aucune provenance de consentement — l'audit l'a vérifié
// colonne par colonne.
//
// Conséquence directe et non négociable : la notice ne doit jamais affirmer que DOMIORA détient un
// consentement marketing, et aucune automatisation de prospection électronique B2C ne peut être
// ajoutée avant MARKETING_CONSENT_V1.
export const MARKETING_B2C_EMAIL_POLICY = "NOT_SUPPORTED_WITHOUT_MARKETING_CONSENT" as const;

export const MARKETING_B2C_EMAIL_JUSTIFICATION =
  "La prospection commerciale par voie électronique vers un particulier requiert un consentement préalable spécifique et démontrable, sauf exception juridique applicable et démontrée. Aucun champ de consentement marketing, d'opt-in, de date de consentement ni de provenance de consentement n'existe dans le schéma. Cette finalité n'est donc pas supportée, et aucune notice ne doit laisser entendre le contraire. Futur lot : MARKETING_CONSENT_V1.";

// ─────────────────────────────── DESTINATAIRES ───────────────────────────────

// Deux natures à ne pas confondre : un DESTINATAIRE reçoit les données pour ses propres besoins ;
// un PRESTATAIRE TECHNIQUE les traite pour le compte du responsable. La qualification juridique de
// chacun reste à valider — aucun DPA, aucun contrat de sous-traitance n'existe dans le dépôt.
export type NatureDestinataire = "DESTINATAIRE" | "PRESTATAIRE_TECHNIQUE";

export interface CategorieDestinataire {
  readonly cle: string;
  readonly libelle: string;
  readonly nature: NatureDestinataire;
  readonly donneesConcernees: string;
  readonly actifEnProduction: boolean;
  readonly qualificationJuridique: "TO_VALIDATE";
}

export const DESTINATAIRES_V1: readonly CategorieDestinataire[] = Object.freeze([
  Object.freeze({
    cle: "NOTAIRE",
    libelle: "Étude notariale destinataire du dossier de transaction",
    nature: "DESTINATAIRE",
    donneesConcernees: "Pièces du dossier et identité des parties à la transaction",
    actifEnProduction: true,
    qualificationJuridique: "TO_VALIDATE",
  }),
  Object.freeze({
    cle: "HEBERGEUR",
    libelle: "Hébergeur de l'application, de la base de données et du stockage documentaire",
    nature: "PRESTATAIRE_TECHNIQUE",
    donneesConcernees: "L'ensemble des données applicatives et documentaires",
    actifEnProduction: true,
    qualificationJuridique: "TO_VALIDATE",
  }),
  Object.freeze({
    cle: "FOURNISSEUR_MESSAGERIE_ET_AGENDA",
    libelle: "Fournisseur de messagerie et d'agenda du conseiller",
    nature: "PRESTATAIRE_TECHNIQUE",
    donneesConcernees:
      "Destinataire, objet et corps des messages envoyés ; événements de l'agenda consultés en lecture",
    actifEnProduction: true,
    qualificationJuridique: "TO_VALIDATE",
  }),
  Object.freeze({
    cle: "SERVICES_DE_DONNEES_PUBLIQUES",
    libelle:
      "Services de données publiques interrogés pour enrichir la présentation d'un bien (géocodage, transports, commerces, écoles, marché, patrimoine)",
    nature: "PRESTATAIRE_TECHNIQUE",
    // L'adresse d'un bien peut être une donnée personnelle indirecte pour son propriétaire : le
    // géocodage transmet cette adresse en clair. L'inscrire est plus honnête que de ranger ces
    // appels parmi les données non personnelles.
    donneesConcernees: "Adresse du bien ou ses coordonnées géographiques",
    actifEnProduction: true,
    qualificationJuridique: "TO_VALIDATE",
  }),
  Object.freeze({
    cle: "SERVICE_REFORMULATION_TEXTE",
    libelle: "Service de reformulation de brouillon de message",
    nature: "PRESTATAIRE_TECHNIQUE",
    donneesConcernees:
      "Brouillon de message, prénom du destinataire, adresse du bien, date de visite et critères du projet",
    // DÉSACTIVÉ EN PRODUCTION, vérifié : les variables de configuration sont absentes de
    // l'environnement de production. Ne pas activer avant qualification du fournisseur,
    // localisation des traitements, conditions contractuelles et mise à jour de la notice
    // (ADR-065 §10).
    actifEnProduction: false,
    qualificationJuridique: "TO_VALIDATE",
  }),
]);

// ─────────────────────────────── DROITS ───────────────────────────────

// Les droits sont déclarés ici tels qu'ils existent, et leur OUTILLAGE est déclaré séparément : le
// produit n'offre aujourd'hui aucun parcours de demande, et seule la rectification dispose
// d'écrans. Déclarer un droit « disponible » parce qu'il est exerçable par intervention manuelle
// sur la base serait un abus de langage.
export interface DroitPersonne {
  readonly cle: string;
  readonly libelle: string;
  readonly outillageProduit: "NON_OUTILLE" | "PARTIEL" | "OUTILLE";
  readonly contrainteTechnique?: string;
}

export const DROITS_V1: readonly DroitPersonne[] = Object.freeze([
  Object.freeze({ cle: "ACCES", libelle: "Droit d'accès", outillageProduit: "NON_OUTILLE" }),
  Object.freeze({
    cle: "RECTIFICATION",
    libelle: "Droit de rectification",
    outillageProduit: "PARTIEL",
    contrainteTechnique:
      "Les fiches vivantes sont modifiables, mais les instantanés figés à la signature d'un bon de visite ne le sont pas par conception, et un contact absorbé par une fusion est figé.",
  }),
  Object.freeze({
    cle: "EFFACEMENT",
    libelle: "Droit à l'effacement",
    outillageProduit: "NON_OUTILLE",
    contrainteTechnique:
      "Aucun chemin de suppression n'existe pour un contact, une visite ou un bon de visite signé, et le stockage documentaire n'expose aucune fonction de suppression. Que des données probatoires doivent ou non être effacées reste une question distincte de cette contrainte technique.",
  }),
  Object.freeze({ cle: "OPPOSITION", libelle: "Droit d'opposition", outillageProduit: "NON_OUTILLE" }),
  Object.freeze({ cle: "LIMITATION", libelle: "Droit à la limitation", outillageProduit: "NON_OUTILLE" }),
  Object.freeze({
    cle: "PORTABILITE",
    libelle: "Droit à la portabilité",
    outillageProduit: "NON_OUTILLE",
    contrainteTechnique:
      "L'export documentaire existant porte sur le dossier d'un bien, jamais sur les données d'une personne.",
  }),
  Object.freeze({
    cle: "RECLAMATION_AUTORITE",
    libelle: "Droit d'introduire une réclamation auprès de l'autorité de contrôle",
    outillageProduit: "NON_OUTILLE",
  }),
]);

// L'autorité de contrôle est nommée par sa compétence, sans coordonnées codées en dur : une adresse
// postale ou une URL changerait sans que personne ne pense à rouvrir ce fichier.
export const AUTORITE_DE_CONTROLE = "Commission nationale de l'informatique et des libertés (CNIL)" as const;

// ─────────────────── STRUCTURE ARTICLE 13 / ARTICLE 14 ───────────────────

// Deux régimes d'information selon l'origine des données, et deux moments. Ce lot définit la
// STRUCTURE ; la remise est portée par PRIVACY_NOTICE_DELIVERY_V1 (Article 13) et
// CONTACT_PRIVACY_INFORMATION_V1 (Article 14).
export const INFORMATION_ARTICLE_13 = Object.freeze({
  regime: "ARTICLE_13" as const,
  origine: "Données collectées directement auprès de la personne concernée",
  // Un seul point aujourd'hui, établi par l'audit : le formulaire de signature du bon de visite.
  pointsDeCollecte: Object.freeze(["BON_VISITE_SIGNATURE"]),
  moment: "Au moment de la collecte, donc avant la saisie et la signature définitive",
  statutLivraison: "NOT_IMPLEMENTED" as const,
});

export const INFORMATION_ARTICLE_14 = Object.freeze({
  regime: "ARTICLE_14" as const,
  origine: "Données obtenues autrement que directement auprès de la personne concernée",
  pointsDeCollecte: Object.freeze([
    "CONTACT_CREE_PAR_LE_CONSEILLER",
    "ACQUEREUR_SAISI_PAR_LE_CONSEILLER",
    "PROSPECT_VENDEUR_SAISI_PAR_LE_CONSEILLER",
    "DONNEES_ISSUES_DE_SOURCES_EXTERNES",
    "TIERS_INCIDENTS_DE_L_AGENDA",
  ]),
  moment:
    "Au plus tard lors de la première communication adressée à la personne lorsqu'une communication intervient, et à défaut selon le délai applicable",
  statutLivraison: "NOT_IMPLEMENTED" as const,
});

// ─────────────────────────────── PUBLICATION ───────────────────────────────

// POURQUOI LA NOTICE N'EST PAS PUBLIÉE PAR CE LOT, et pourquoi c'est une décision et non un retard.
//
// Une notice publique énonce des durées de conservation. Le produit n'en applique aujourd'hui
// aucune : il n'existe ni purge, ni cron de rétention, et la doctrine en vigueur est la
// conservation indéfinie (ADR-012/013). Publier « trois ans » ou « cinq ans » dans ces conditions
// serait un engagement que le produit n'exécute pas — un défaut plus grave que l'absence de notice,
// parce qu'il est affirmatif.
//
// S'y ajoutent trois catégories de conservation encore UNDECIDED, et une identité de responsable du
// traitement qui n'est renseignée dans aucun workspace à la sortie de ce lot.
export const PUBLIC_PRIVACY_PAGE_ENABLED = false;
export const SHORT_NOTICE_AT_BON_VISITE_ENABLED = false;

export interface BlocagePublication {
  readonly cle: string;
  readonly explication: string;
}

// Les conditions restant à lever avant d'activer la notice, calculées et non recopiées : la liste
// se réduit d'elle-même à mesure que les lots suivants livrent.
export function blocagesPublicationNotice(): readonly BlocagePublication[] {
  const blocages: BlocagePublication[] = [];
  if (!RETENTION_ENFORCEMENT_V1_LIVRE) {
    blocages.push({
      cle: "RETENTION_ENFORCEMENT_V1_ABSENT",
      explication:
        "Les politiques de conservation sont décidées mais ne sont pas appliquées par le produit : aucune purge n'existe. Publier ces durées serait un engagement non exécuté.",
    });
  }
  const indecises = politiquesConservationIndecises();
  if (indecises.length > 0) {
    blocages.push({
      cle: "POLITIQUES_CONSERVATION_UNDECIDED",
      explication: `Catégories de conservation non tranchées : ${indecises.map((p) => p.cle).join(", ")}.`,
    });
  }
  return Object.freeze(blocages);
}

// Instantané des décisions structurelles, pour un test de version et pour les lots de delivery. Ce
// n'est pas une notice rendue : aucun texte destiné aux personnes n'est produit ici.
export function decisionsPrivacyVersionnees() {
  return Object.freeze({
    version: PRIVACY_NOTICE_VERSION,
    controllerModel: CONTROLLER_MODEL,
    finalites: FINALITES_V1,
    destinataires: DESTINATAIRES_V1,
    conservation: POLITIQUES_CONSERVATION_V1,
    droits: DROITS_V1,
    autoriteDeControle: AUTORITE_DE_CONTROLE,
    article13: INFORMATION_ARTICLE_13,
    article14: INFORMATION_ARTICLE_14,
    marketingB2cEmailPolicy: MARKETING_B2C_EMAIL_POLICY,
    publicationActivee: PUBLIC_PRIVACY_PAGE_ENABLED,
    blocagesPublication: blocagesPublicationNotice(),
  });
}
