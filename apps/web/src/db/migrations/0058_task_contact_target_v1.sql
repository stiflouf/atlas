ALTER TABLE "envois_email" DROP CONSTRAINT "envois_email_origine_intention_check";--> statement-breakpoint
ALTER TABLE "taches" DROP CONSTRAINT "taches_une_seule_cible_check";--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_email" ADD CONSTRAINT "envois_email_origine_intention_check" CHECK ("envois_email"."origine_intention" IS NULL OR "envois_email"."origine_intention" IN (
        'relance_prospect_vendeur','suivi_rdv_estimation','suivi_acquereur','suivi_visite',
        'demande_document_manquant','relance_piece_a_verifier','message_compromis','message_notaire',
        'retour_vendeur_apres_visite',
        'message_contact'
      ));--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_une_seule_cible_check" CHECK ((
        (case when "taches"."bien_id" is not null then 1 else 0 end) +
        (case when "taches"."acquereur_id" is not null then 1 else 0 end) +
        (case when "taches"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "taches"."visite_id" is not null then 1 else 0 end) +
        (case when "taches"."offre_id" is not null then 1 else 0 end) +
        (case when "taches"."compromis_id" is not null then 1 else 0 end) +
        (case when "taches"."remuneration_id" is not null then 1 else 0 end) +
        (case when "taches"."visite_canonique_id" is not null then 1 else 0 end) +
        (case when "taches"."contact_id" is not null then 1 else 0 end)
      ) <= 1);