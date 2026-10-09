-- RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — journal technique du moteur de rétention.
--
-- STRICTEMENT ADDITIVE : deux CREATE TABLE, deux FK, deux index. Aucune table métier n'est touchée,
-- aucune colonne n'est ajoutée ailleurs, aucun DROP, aucun UPDATE, aucun backfill, aucun trigger,
-- aucune colonne de suspension pour contentieux. Les deux tables sortent de cette migration VIDES,
-- et `actions_retention` le reste à la fin du lot : le dry-run n'écrit que `runs_retention`.
--
-- `actions_retention` ne porte PAS `workspace_id` : c'est une FEUILLE de `runs_retention`
-- (ADR-054 §7), et dupliquer l'appartenance créerait une seconde vérité pouvant diverger de celle
-- du run. Le périmètre d'une action est celui du balayage qui l'a produite.
--
-- `actions_retention.action` n'admet qu'une seule valeur, et c'est le point fail-closed de cette
-- migration : aucune capacité de suppression n'existe dans le produit, donc aucun verbe de
-- suppression n'est accepté par la base. Un INSERT prématuré d'un verbe destructif est refusé par
-- PostgreSQL, pas seulement par une revue de code. Le lot qui livrera réellement une suppression
-- élargira ce CHECK par migration — ce qui le rendra visible et daté.
--
-- `runs_retention.mode` accepte 'apply' alors qu'aucun chemin applicatif ne peut l'écrire (garde
-- dans executerDryRunRetention et dans la route). La valeur existe pour que le journal d'une future
-- purge ne soit pas distinguable d'un dry-run par une colonne ajoutée après coup, ce qui rendrait
-- l'historique antérieur muet sur ce qu'il était.
--
-- Ce que ces tables ne doivent JAMAIS contenir : nom, prénom, email, téléphone, adresse, texte
-- libre, snapshot, contenu de document, image de signature. `entity_type` + `entity_id` prouvent
-- qu'une ligne précise a été traitée sans permettre de reconstituer qui elle désignait.

CREATE TABLE "actions_retention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"policy_code" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"eligible_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"executed_at" timestamp with time zone,
	"result" text,
	"erreur_technique" text,
	CONSTRAINT "actions_retention_action_check" CHECK ("actions_retention"."action" IN ('DRY_RUN_DETECTED')),
	CONSTRAINT "actions_retention_result_check" CHECK ("actions_retention"."result" IS NULL OR "actions_retention"."result" IN ('SUCCES','ECHEC')),
	CONSTRAINT "actions_retention_policy_code_check" CHECK ("actions_retention"."policy_code" IN (
        'PROSPECT_MARKETING','CUSTOMER_MARKETING','SIGNED_VISIT_FORM',
        'SESSION','OIDC_STATE','GOOGLE_CONNECTION',
        'TRANSACTION_DOCUMENTS','FREE_TEXT_NOTES','ACTIVE_CLIENT_OR_PROJECT_DATA'
      ))
);
--> statement-breakpoint
CREATE TABLE "runs_retention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" text NOT NULL,
	"demarre_le" timestamp with time zone DEFAULT now() NOT NULL,
	"ordre" bigint GENERATED ALWAYS AS IDENTITY (sequence name "runs_retention_ordre_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"termine_le" timestamp with time zone,
	"nombre_politiques" integer,
	"nombre_eligibles" integer,
	"nombre_bloquees" integer,
	"erreur_technique" text,
	CONSTRAINT "runs_retention_mode_check" CHECK ("runs_retention"."mode" IN ('dry-run','apply'))
);
--> statement-breakpoint
ALTER TABLE "actions_retention" ADD CONSTRAINT "actions_retention_run_id_runs_retention_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs_retention"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs_retention" ADD CONSTRAINT "runs_retention_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_retention_run_idx" ON "actions_retention" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_retention_workspace_demarre_idx" ON "runs_retention" USING btree ("workspace_id","demarre_le");