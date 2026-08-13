CREATE TABLE "taches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titre" text NOT NULL,
	"contexte" text,
	"type" text DEFAULT 'autre' NOT NULL,
	"priorite" text DEFAULT 'normale' NOT NULL,
	"echeance" date,
	"origine" text DEFAULT 'manuelle' NOT NULL,
	"origine_code" text,
	"bien_id" uuid,
	"acquereur_id" uuid,
	"prospect_vendeur_id" uuid,
	"visite_id" uuid,
	"offre_id" uuid,
	"compromis_id" uuid,
	"remuneration_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"terminee_le" timestamp with time zone,
	"annulee_le" timestamp with time zone,
	CONSTRAINT "taches_type_check" CHECK ("taches"."type" IN ('appel','email','message','document','relance','autre')),
	CONSTRAINT "taches_priorite_check" CHECK ("taches"."priorite" IN ('haute','normale','basse')),
	CONSTRAINT "taches_origine_check" CHECK ("taches"."origine" IN ('manuelle','automatique')),
	CONSTRAINT "taches_une_seule_cible_check" CHECK ((
        (case when "taches"."bien_id" is not null then 1 else 0 end) +
        (case when "taches"."acquereur_id" is not null then 1 else 0 end) +
        (case when "taches"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "taches"."visite_id" is not null then 1 else 0 end) +
        (case when "taches"."offre_id" is not null then 1 else 0 end) +
        (case when "taches"."compromis_id" is not null then 1 else 0 end) +
        (case when "taches"."remuneration_id" is not null then 1 else 0 end)
      ) <= 1)
);
--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_prospect_vendeur_id_prospects_vendeurs_id_fk" FOREIGN KEY ("prospect_vendeur_id") REFERENCES "public"."prospects_vendeurs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_visite_id_comptes_rendus_visite_id_fk" FOREIGN KEY ("visite_id") REFERENCES "public"."comptes_rendus_visite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_offre_id_offres_id_fk" FOREIGN KEY ("offre_id") REFERENCES "public"."offres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_compromis_id_compromis_id_fk" FOREIGN KEY ("compromis_id") REFERENCES "public"."compromis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_remuneration_id_remuneration_id_fk" FOREIGN KEY ("remuneration_id") REFERENCES "public"."remuneration"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Migration des données existantes de "actions" vers "taches" (ADR-028). Aucune heuristique : un
-- audit préalable (2026-08-13, avant génération de cette migration) a interrogé la base réelle et
-- confirmé zéro ligne "actions" portant simultanément bien_id et acquereur_id — aucun arbitrage de
-- rattachement n'a donc été nécessaire. Les id non-UUID (catalogue mocké, jamais une entité réelle
-- persistée) perdent uniquement leur rattachement bien_id/acquereur_id, jamais la tâche elle-même,
-- même convention que le reste du codebase (compromisRepository.UUID_REGEX et consorts : un id
-- non-UUID ne correspond à aucune ligne réelle). Si une ligne portait les deux à la fois, cette
-- instruction échouerait sur taches_une_seule_cible_check plutôt que de choisir arbitrairement.
INSERT INTO "taches" ("id", "titre", "contexte", "type", "priorite", "echeance", "bien_id", "acquereur_id", "cree_le", "terminee_le")
SELECT
  "id", "titre", "contexte", "type", "priorite", "echeance",
  CASE WHEN "bien_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN "bien_id"::uuid ELSE NULL END,
  CASE WHEN "acquereur_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN "acquereur_id"::uuid ELSE NULL END,
  "cree_le",
  CASE WHEN "statut" = 'termine' THEN "termine_le" ELSE NULL END
FROM "actions";
--> statement-breakpoint
-- Migration de prospects_vendeurs.prochaine_action/prochaine_action_le (champs simples, ADR-027
-- point 7) vers une tâche dédiée par prospect concerné (ADR-028) — audit préalable : zéro ligne
-- concernée dans cette base. Écrite pour rester correcte si des lignes existaient : type 'autre'
-- (aucune information de type plus précise n'existait dans ces deux champs texte libre), origine
-- 'manuelle' (anciennes saisies humaines, jamais une génération automatique). prochaine_action_le
-- sans prochaine_action ne devrait jamais exister (déjà rejeté par mettreAJourProchaineActionAction
-- du temps où ce champ existait) ; le WHERE ci-dessous l'exclut explicitement plutôt que d'échouer
-- sur titre NOT NULL si une telle ligne existait malgré tout.
INSERT INTO "taches" ("id", "titre", "echeance", "prospect_vendeur_id", "type", "priorite", "origine")
SELECT gen_random_uuid(), "prochaine_action", "prochaine_action_le", "id", 'autre', 'normale', 'manuelle'
FROM "prospects_vendeurs"
WHERE "prochaine_action" IS NOT NULL;
--> statement-breakpoint
DROP TABLE "actions" CASCADE;
--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" DROP COLUMN "prochaine_action";
--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" DROP COLUMN "prochaine_action_le";
