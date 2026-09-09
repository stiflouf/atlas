-- ADR-055 §B — côté VENDEUR du modèle canonique : le projet de vente, et l'extension de
-- `parties_projet` aux deux types de projet. Migration STRICTEMENT ADDITIVE : aucune table
-- supprimée ou renommée, aucune colonne retirée, aucune donnée modifiée, aucun backfill.
--
-- `prospects_vendeurs` reste INTACT et reste la source de vérité du pipeline vendeur, de la
-- signature de mandat, des tâches, des événements et de l'UI. Il gagne seulement un
-- `projet_vendeur_id` NULLABLE, pendant vendeur de `acquereurs.projet_acquereur_id`, qu'aucune
-- ligne historique ne franchit : un prospect historique peut être un lead mort, un doublon, ou
-- l'un de plusieurs prospects décrivant le MÊME projet à deux propriétaires.
--
-- ORDRE VOLONTAIRE sur `parties_projet`, pour qu'AUCUNE ligne existante ne devienne invalide :
--   1. le `CHECK` de rôle est remplacé par un SUR-ENSEMBLE ('vendeur','co_vendeur' ajoutés) — les
--      lignes acquéreur existantes le satisfont toujours ;
--   2. `projet_acquereur_id` perd son NOT NULL — les lignes existantes gardent leur valeur ;
--   3. `projet_vendeur_id` est ajoutée nullable, donc NULL sur tout l'existant ;
--   4. le `CHECK` « exactement une cible » n'est posé qu'ENSUITE : chaque ligne existante compte
--      alors 1 (acquéreur) + 0 (vendeur) = 1, et passe.
-- Poser le CHECK avant l'étape 2 ou 3 aurait rejeté la migration entière.
--
-- `projets_vendeur` naît racine (ADR-054 §7) : `workspace_id` NOT NULL, FK, AUCUN DEFAULT. Il ne
-- porte aucune identité humaine, aucune description de bien, et AUCUN attribut de mandat —
-- `mandats` (ADR-055 §F) n'existe pas ; `mandat_propose_le`/`mandat_signe_le` sont des jalons du
-- projet, pas des propriétés du mandat.

CREATE TABLE "projets_vendeur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"origine_lead" text,
	"origine_lead_detail" text,
	"qualifie_le" timestamp with time zone,
	"rdv_estimation_prevu_le" timestamp with time zone,
	"rdv_estimation_realise_le" timestamp with time zone,
	"estimation_proposee_centimes" integer,
	"estimation_proposee_le" date,
	"mandat_propose_le" timestamp with time zone,
	"mandat_signe_le" timestamp with time zone,
	"motif_perte" text,
	"date_perte" date,
	"dernier_contact_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"archive_le" timestamp with time zone,
	CONSTRAINT "projets_vendeur_estimation_positive_check" CHECK ("projets_vendeur"."estimation_proposee_centimes" IS NULL OR "projets_vendeur"."estimation_proposee_centimes" > 0),
	CONSTRAINT "projets_vendeur_origine_lead_check" CHECK ("projets_vendeur"."origine_lead" IS NULL OR "projets_vendeur"."origine_lead" IN ('recommandation','ancien_client','site_web','reseaux_sociaux','prospection_terrain','panneau','salon_evenement','apport_affaire','autre')),
	CONSTRAINT "projets_vendeur_motif_perte_check" CHECK ("projets_vendeur"."motif_perte" IS NULL OR "projets_vendeur"."motif_perte" IN ('projet_abandonne','choix_agence_concurrente','desaccord_estimation','injoignable','bien_vendu_autrement','delai_calendrier','autre'))
);
--> statement-breakpoint
ALTER TABLE "parties_projet" DROP CONSTRAINT "parties_projet_role_check";--> statement-breakpoint
ALTER TABLE "parties_projet" ALTER COLUMN "projet_acquereur_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parties_projet" ADD COLUMN "projet_vendeur_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD COLUMN "projet_vendeur_id" uuid;--> statement-breakpoint
ALTER TABLE "projets_vendeur" ADD CONSTRAINT "projets_vendeur_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties_projet" ADD CONSTRAINT "parties_projet_projet_vendeur_id_projets_vendeur_id_fk" FOREIGN KEY ("projet_vendeur_id") REFERENCES "public"."projets_vendeur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD CONSTRAINT "prospects_vendeurs_projet_vendeur_id_projets_vendeur_id_fk" FOREIGN KEY ("projet_vendeur_id") REFERENCES "public"."projets_vendeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties_projet" ADD CONSTRAINT "parties_projet_projet_vendeur_contact_unique" UNIQUE("projet_vendeur_id","contact_id");--> statement-breakpoint
ALTER TABLE "parties_projet" ADD CONSTRAINT "parties_projet_une_seule_cible_check" CHECK ((
        (case when "parties_projet"."projet_acquereur_id" is not null then 1 else 0 end) +
        (case when "parties_projet"."projet_vendeur_id" is not null then 1 else 0 end)
      ) = 1);--> statement-breakpoint
ALTER TABLE "parties_projet" ADD CONSTRAINT "parties_projet_role_check" CHECK ("parties_projet"."role" IN ('acquereur','co_acquereur','vendeur','co_vendeur'));