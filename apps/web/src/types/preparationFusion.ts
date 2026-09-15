import type { Contact } from "./contact";
import type {
  AvertissementFusionContact,
  ChampIdentiteContact,
  IdentiteContactAttendue,
} from "./contactFusion";
import type { RoleContact } from "./rechercheContact";

// ADR-059 — ce que l'écran de fusion MONTRE avant qu'un humain ne décide : les deux Contacts tels
// qu'ils sont, ce qui devra être tranché champ par champ, ce qui sera déplacé, ce qui devra être
// acquitté. Lecture pure ; le moteur revérifie tout sous verrou.

export type CoteFusion = {
  contact: Contact;
  // Exactement ce que le moteur recomparera : l'identité affichée, `modifieLe` compris.
  identiteAttendue: IdentiteContactAttendue;
  roles: RoleContact[];
  nbProjets: number;
  // Champs d'identité verrouillés par une correction humaine (ADR-056 §4) — affichés, jamais
  // bloquants : la fusion est elle-même une décision humaine.
  champsModifiesManuellement: ChampIdentiteContact[];
};

// `identique` : aucune décision ; `absence_comblee` : une seule valeur existe, proposée ;
// `conflit` : deux valeurs différentes, l'humain doit choisir.
export type ResolutionChampFusion = {
  champ: ChampIdentiteContact;
  valeurSurvivant?: string;
  valeurAbsorbe?: string;
  nature: "identique" | "absence_comblee" | "conflit";
};

export type ImpactFusion = {
  // Union des projets canoniques des deux Contacts ; `projetsCommuns` en est l'intersection — des
  // participations en double qui seront regroupées.
  projetsConcernes: number;
  projetsCommuns: number;
  interactionsDeplacees: number;
  dossiersAcquereurDeplaces: number;
  dossiersVendeurDeplaces: number;
  identifiantsExternesDeplaces: number;
};

export type PreparationFusionContacts =
  | {
      statut: "pret";
      survivant: CoteFusion;
      absorbe: CoteFusion;
      champs: ResolutionChampFusion[];
      impact: ImpactFusion;
      avertissements: AvertissementFusionContact[];
    }
  | { statut: "meme_contact" }
  | { statut: "contact_introuvable" }
  | { statut: "deja_fusionne" };
