-- ADR-054 — fondation de l'appartenance (OWNERSHIP). Migration ADDITIVE et comportementalement
-- neutre : aucune table supprimée ou renommée, aucune colonne retirée, aucune lecture applicative
-- modifiée. Le produit reste mono-conseiller après cette migration.
--
-- ATTENTION — ce fichier a été COMPLÉTÉ À LA MAIN après `drizzle-kit generate` : l'INSERT du
-- workspace historique ci-dessous est indispensable et drizzle-kit ne le génère pas. Sans lui, sur
-- une base CONTENANT DÉJÀ DES DONNÉES, chaque `ADD CONSTRAINT ... FOREIGN KEY` de la fin du fichier
-- échouerait : les lignes existantes reçoivent `workspace_id = 'default'` par le DEFAULT, et cette
-- valeur doit déjà exister dans `workspaces`. L'ordre des instructions est donc contraint :
--   1. CREATE TABLE workspaces  ->  2. INSERT du workspace 'default'
--   -> 3. ADD COLUMN workspace_id (DEFAULT 'default', NOT NULL)  ->  4. ADD CONSTRAINT FOREIGN KEY.
-- Ne jamais réordonner. Ne jamais régénérer ce fichier sans ré-appliquer l'INSERT.
--
-- Aucune ligne n'est insérée dans `workspace_membres` : le `sub` Google n'est jamais persisté
-- (ADR-047), il n'est connu qu'au retour du callback OIDC — une appartenance initiale ne peut pas
-- être établie de façon déterministe ici, et l'inventer créerait une identité qui n'existe pas.

CREATE TABLE "workspace_membres" (
	"workspace_id" text NOT NULL,
	"identite_sub" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"ajoute_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_membres_workspace_id_identite_sub_pk" PRIMARY KEY("workspace_id","identite_sub"),
	CONSTRAINT "workspace_membres_role_check" CHECK ("workspace_membres"."role" IN ('owner'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"nom" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Workspace historique : le monde mono-conseiller d'avant ADR-054. `nom` reste NULL — aucun libellé
-- n'a jamais été saisi et la migration n'en invente aucun (ADR-009 : NULL = inconnu, jamais une
-- valeur fabriquée). `ON CONFLICT DO NOTHING` rend l'instruction rejouable sans erreur.
INSERT INTO "workspaces" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "acquereurs" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "biens" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibilites_a_resynchroniser" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "envois_email" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs_scan_automatisation" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_membres" ADD CONSTRAINT "workspace_membres_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquereurs" ADD CONSTRAINT "acquereurs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biens" ADD CONSTRAINT "biens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibilites_a_resynchroniser" ADD CONSTRAINT "compatibilites_a_resynchroniser_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_email" ADD CONSTRAINT "envois_email_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD CONSTRAINT "prospects_vendeurs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs_scan_automatisation" ADD CONSTRAINT "runs_scan_automatisation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;