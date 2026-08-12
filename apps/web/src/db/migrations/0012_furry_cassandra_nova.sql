ALTER TABLE "compromis" ADD COLUMN "date_annulation" date;--> statement-breakpoint
ALTER TABLE "compromis" ADD COLUMN "motif_annulation" text;--> statement-breakpoint
ALTER TABLE "offres" ADD COLUMN "date_decision" date;--> statement-breakpoint
ALTER TABLE "offres" ADD COLUMN "motif_perte" text;--> statement-breakpoint
ALTER TABLE "compromis" ADD CONSTRAINT "compromis_motif_annulation_check" CHECK ("compromis"."motif_annulation" IS NULL OR "compromis"."motif_annulation" IN ('financement_refuse','acquereur_se_retire','vendeur_se_retire','desaccord_prix','juridique_administratif','delai_calendrier','autre'));--> statement-breakpoint
ALTER TABLE "offres" ADD CONSTRAINT "offres_motif_perte_check" CHECK ("offres"."motif_perte" IS NULL OR "offres"."motif_perte" IN ('financement_refuse','acquereur_se_retire','vendeur_se_retire','desaccord_prix','juridique_administratif','delai_calendrier','autre'));