-- PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — identité juridique du responsable du traitement
-- métier, au niveau du workspace.
--
-- STRICTEMENT ADDITIVE ET NULLABLE. Aucune colonne NOT NULL, aucun DEFAULT, AUCUN BACKFILL — et
-- c'est le point central de cette migration, pas une précaution de style.
--
-- Contrairement à 0057, aucun backfill n'est possible ici, même sous garde d'unicité d'identité.
-- 0057 pouvait rattacher un historique à l'unique identité humaine présente : le rattachement était
-- un CONSTAT. Ici, il n'existe nulle part dans le produit la moindre trace d'une raison sociale,
-- d'une adresse postale ou d'un SIREN. Les seules valeurs approchantes seraient `workspaces.nom`
-- (un libellé d'affichage libre), `ATLAS_ADVISOR_DISPLAY_NAME` (nom d'affichage d'instance, avec
-- repli « Conseiller DOMIORA ») ou le nom du produit — et aucune des trois n'est une identité
-- juridique. Les écrire ici fabriquerait un responsable du traitement qui n'existe pas, dans les
-- colonnes mêmes destinées à l'identifier.
--
-- Le workspace historique `'default'` sort donc de cette migration avec treize colonnes à NULL,
-- et c'est l'état correct : l'identité est renseignée par son propriétaire depuis
-- /parametres/confidentialite, jamais déduite.
--
-- Les deux CHECK portent sur la FORME et laissent passer l'absence (`IS NULL OR ...`) : ils ne
-- peuvent donc pas échouer sur les lignes existantes. Aucun CHECK d'email — le dépôt n'a aucun
-- pattern SQL d'email sur ses quatre colonnes d'email existantes, et la validation reste
-- applicative (`identiteResponsableFormulaire.ts`).
--
-- `privacy_identity_modifie_le` suit le patron `modifie_le` du dépôt (ADR-057), mais NULLABLE sans
-- défaut : « jamais renseigné » doit rester distinct de « renseigné à la création du workspace ».
--
-- Rien d'autre n'est touché : aucune table, aucune autre colonne, aucun index, aucune FK. Aucun
-- schéma fiscal (le problème d'ownership du dossier fiscal reste un chantier séparé, ADR-065 §9).

ALTER TABLE "workspaces" ADD COLUMN "controller_legal_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_legal_form" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_trade_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_address_line1" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_address_line2" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_postal_code" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_city" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_country_code" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "controller_siren" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "privacy_rights_email" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "dpo_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "dpo_email" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "privacy_identity_modifie_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_controller_siren_check" CHECK ("workspaces"."controller_siren" IS NULL OR "workspaces"."controller_siren" ~ '^[0-9]{9}$');--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_controller_country_code_check" CHECK ("workspaces"."controller_country_code" IS NULL OR "workspaces"."controller_country_code" ~ '^[A-Z]{2}$');