-- SELLER_FEEDBACK_INTERACTION_V1 (ADR-063) — strictement additive : deux colonnes nullables sur
-- `interactions` (visite_id, rattachement mutuellement exclusif avec les trois existants ; nature_metier,
-- distinct du canal `type`), un index unique partiel protégeant l'action initiale contre un double
-- submit. Les DROP+re-CREATE de contraintes CHECK ci-dessous ne font qu'élargir leur portée (même
-- idiome que 0046/0047/0050/0051/0052) — aucune table supprimée, aucune colonne retirée, aucun
-- backfill, aucune donnée existante modifiée ou réinterprétée.
ALTER TABLE "interactions" DROP CONSTRAINT "interactions_un_seul_contexte_check";--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "visite_id" uuid;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "nature_metier" text;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_visite_id_visites_id_fk" FOREIGN KEY ("visite_id") REFERENCES "public"."visites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interactions_visite_retour_vendeur_unique" ON "interactions" USING btree ("visite_id","contact_id") WHERE "interactions"."nature_metier" = 'retour_vendeur_post_visite';--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_nature_metier_check" CHECK ("interactions"."nature_metier" IS NULL OR "interactions"."nature_metier" IN ('retour_vendeur_post_visite'));--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_un_seul_contexte_check" CHECK ((
        (case when "interactions"."projet_acquereur_id" is not null then 1 else 0 end) +
        (case when "interactions"."projet_vendeur_id" is not null then 1 else 0 end) +
        (case when "interactions"."bien_id" is not null then 1 else 0 end) +
        (case when "interactions"."visite_id" is not null then 1 else 0 end)
      ) <= 1);