CREATE UNIQUE INDEX "compromis_bien_id_en_cours_unique" ON "compromis" USING btree ("bien_id") WHERE "compromis"."statut" = 'en_cours';--> statement-breakpoint
ALTER TABLE "compromis" ADD CONSTRAINT "compromis_offre_id_unique" UNIQUE("offre_id");--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_tache_id_unique" UNIQUE("tache_id");