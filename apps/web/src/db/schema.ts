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
  },
  (table) => [
    check(
      "acquereurs_stade_projet_check",
      sql`${table.stadeProjet} IN ('decouverte','recherche_active','offre','compromis','acte')`
    ),
  ]
);
