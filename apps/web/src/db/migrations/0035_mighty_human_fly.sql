-- ADR-055 §B — deuxième brique du modèle canonique : le PROJET acquéreur, et la RELATION qui y
-- rattache des personnes. Migration STRICTEMENT ADDITIVE : aucune table supprimée ou renommée,
-- aucune colonne retirée, aucune donnée modifiée, aucun backfill.
--
-- `acquereurs` reste INTACT et reste la source de vérité du matching, des visites, des offres et de
-- l'UI. Il gagne seulement un `projet_acquereur_id` NULLABLE : un pont, dans le sens ancien ->
-- nouveau, qu'aucune ligne historique ne franchit pour l'instant. Un acquéreur historique peut être
-- une recherche close, abandonnée ou saisie deux fois — en faire mécaniquement un projet actif
-- fabriquerait des faits que personne n'a constatés.
--
-- `projets_acquereur` naît racine (ADR-054 §7) : `workspace_id` NOT NULL, FK, AUCUN DEFAULT. Il ne
-- porte aucune identité humaine — celle-ci vit dans `contacts`, atteint par `parties_projet`.
--
-- `parties_projet` est une FEUILLE : pas de `workspace_id` dupliqué (ADR-054 §7). La base seule ne
-- peut donc pas refuser une participation traversant deux périmètres ; cet invariant est tenu par
-- `ajouterPartieProjet` et prouvé par un test. `projet_acquereur_id` est NOT NULL tant qu'un seul
-- type de projet existe ; le lot qui créera les projets vendeur lèvera ce NOT NULL et posera le
-- `CHECK` « exactement une cible » d'ADR-055 (invariant 5).

CREATE TABLE "parties_projet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"projet_acquereur_id" uuid NOT NULL,
	"role" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_projet_projet_contact_unique" UNIQUE("projet_acquereur_id","contact_id"),
	CONSTRAINT "parties_projet_role_check" CHECK ("parties_projet"."role" IN ('acquereur','co_acquereur'))
);
--> statement-breakpoint
CREATE TABLE "projets_acquereur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"budget_min" integer NOT NULL,
	"budget_max" integer NOT NULL,
	"criteres" text[] DEFAULT '{}' NOT NULL,
	"stade_projet" text DEFAULT 'decouverte' NOT NULL,
	"pieces_min" integer,
	"surface_min" real,
	"accessibilite_requise" boolean,
	"necessite_parking" boolean,
	"necessite_exterieur" boolean,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"archive_le" timestamp with time zone,
	CONSTRAINT "projets_acquereur_stade_projet_check" CHECK ("projets_acquereur"."stade_projet" IN ('decouverte','recherche_active','offre','compromis','acte'))
);
--> statement-breakpoint
ALTER TABLE "acquereurs" ADD COLUMN "projet_acquereur_id" uuid;--> statement-breakpoint
ALTER TABLE "parties_projet" ADD CONSTRAINT "parties_projet_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties_projet" ADD CONSTRAINT "parties_projet_projet_acquereur_id_projets_acquereur_id_fk" FOREIGN KEY ("projet_acquereur_id") REFERENCES "public"."projets_acquereur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projets_acquereur" ADD CONSTRAINT "projets_acquereur_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquereurs" ADD CONSTRAINT "acquereurs_projet_acquereur_id_projets_acquereur_id_fk" FOREIGN KEY ("projet_acquereur_id") REFERENCES "public"."projets_acquereur"("id") ON DELETE no action ON UPDATE no action;