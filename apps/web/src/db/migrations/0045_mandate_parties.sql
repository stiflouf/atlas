-- ADR-060 §16 — MANDATE_PARTIES_V1 (M-3). Migration STRICTEMENT ADDITIVE : une table feuille
-- `parties_mandat` (mandat ↔ contact, rôle `mandant` | `representant`), CHECK rôle, UNIQUE
-- (mandat_id, contact_id), deux FK NO ACTION (rien n'est jamais supprimé, ADR-012), deux index.
-- AUCUN BACKFILL (aucune partie inventée depuis parties_projet ni depuis un propriétaire legacy),
-- aucun `workspace_id` (feuille de `mandats` → `biens`, ADR-054 §7), aucune contrainte « au moins
-- un mandant », aucune table Organisation.
CREATE TABLE "parties_mandat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandat_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_mandat_mandat_contact_unique" UNIQUE("mandat_id","contact_id"),
	CONSTRAINT "parties_mandat_role_check" CHECK ("parties_mandat"."role" IN ('mandant','representant'))
);
--> statement-breakpoint
ALTER TABLE "parties_mandat" ADD CONSTRAINT "parties_mandat_mandat_id_mandats_id_fk" FOREIGN KEY ("mandat_id") REFERENCES "public"."mandats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties_mandat" ADD CONSTRAINT "parties_mandat_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_mandat_mandat_idx" ON "parties_mandat" USING btree ("mandat_id");--> statement-breakpoint
CREATE INDEX "parties_mandat_contact_idx" ON "parties_mandat" USING btree ("contact_id");