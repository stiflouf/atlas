import { pgTable, text, real, timestamp, uuid, unique, check } from "drizzle-orm/pg-core";
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
