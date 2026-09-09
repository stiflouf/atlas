-- ADR-055 §A — première brique du modèle canonique : l'identité d'une personne, indépendante de
-- tout dossier. Migration STRICTEMENT ADDITIVE : aucune table supprimée ou renommée, aucune colonne
-- retirée, aucune donnée modifiée, aucun backfill.
--
-- `prospects_vendeurs` et `acquereurs` restent INTACTS et restent la source de vérité de tous les
-- workflows existants. Ils gagnent seulement un `contact_id` NULLABLE : un pont, dans le sens
-- ancien -> nouveau, qu'aucune ligne historique ne franchit pour l'instant.
--
-- Aucun backfill n'est fait ici, et c'est délibéré (ADR-055 §H) : « 1 ligne = 1 contact »
-- fabriquerait des doublons structurels (le même humain vendeur puis acquéreur produirait deux
-- contacts), tandis qu'un rapprochement automatique sur email/téléphone fusionnerait à tort deux
-- personnes mal saisies. Le rattachement de l'historique est un geste explicite, réservé à son
-- propre lot.
--
-- `contacts` naît directement avec son appartenance (ADR-054 §7) : `workspace_id` NOT NULL, FK vers
-- `workspaces`, et AUCUN DEFAULT — une écriture qui oublierait son périmètre échoue immédiatement.

CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"nom" text NOT NULL,
	"prenom" text,
	"email" text,
	"telephone" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acquereurs" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquereurs" ADD CONSTRAINT "acquereurs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD CONSTRAINT "prospects_vendeurs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;