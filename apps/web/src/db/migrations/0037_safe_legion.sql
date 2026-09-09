-- ADR-055 §F — le MANDAT devient une vraie entité. Migration STRICTEMENT ADDITIVE : aucune table
-- supprimée ou renommée, aucune colonne retirée, aucune donnée modifiée, AUCUN BACKFILL.
--
-- `biens.statut_mandat` et `biens.date_mandat` restent INTACTS et restent la source de vérité des
-- écrans, du tunnel commercial et des automatisations. Aucun pont `biens.mandat_courant_id` n'est
-- créé : « le mandat courant » se DÉDUIT des lignes (celui dont le statut dérivé est actif, prise
-- d'effet la plus récente) ; le stocker serait un cache permanent sans lecteur, qui deviendrait faux
-- le jour où un mandat expire sans qu'aucune écriture ne le corrige.
--
-- AUCUN BACKFILL, et c'est délibéré : un bien historique avec `statut_mandat = 'actif'` peut avoir
-- connu plusieurs mandats successifs, avoir été importé après signature, ou n'avoir aucun projet
-- vendeur canonique. Fabriquer un mandat par bien inventerait une prise d'effet, une durée et une
-- continuité que personne n'a constatées. Seules les signatures POSTÉRIEURES à cette migration
-- produisent un mandat canonique.
--
-- `mandats` est une FEUILLE de `biens` (ADR-054 §7) : `bien_id` NOT NULL, et AUCUN `workspace_id`
-- dupliqué. `projet_vendeur_id` est nullable — un mandat signé depuis une opportunité antérieure au
-- modèle canonique n'a pas de projet à référencer, et le mandat reste un fait.
--
-- AUCUNE unicité sur `bien_id` ni sur `projet_vendeur_id` : un bien peut être remandaté, un projet
-- peut connaître un mandat expiré puis un renouvellement. L'imposer rendrait l'historique
-- inexprimable.
--
-- AUCUN statut stocké (invariant 9) : actif / expiré / résilié se déduisent de `date_debut`,
-- `date_fin` et `resilie_le`. AUCUN identifiant fournisseur (ADR-056).

CREATE TABLE "mandats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"projet_vendeur_id" uuid,
	"date_debut" date NOT NULL,
	"date_fin" date,
	"resilie_le" date,
	"remplace_mandat_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandats_pas_d_auto_remplacement_check" CHECK ("mandats"."remplace_mandat_id" IS NULL OR "mandats"."remplace_mandat_id" <> "mandats"."id"),
	CONSTRAINT "mandats_periode_coherente_check" CHECK ("mandats"."date_fin" IS NULL OR "mandats"."date_fin" >= "mandats"."date_debut"),
	CONSTRAINT "mandats_resiliation_coherente_check" CHECK ("mandats"."resilie_le" IS NULL OR "mandats"."resilie_le" >= "mandats"."date_debut")
);
--> statement-breakpoint
ALTER TABLE "mandats" ADD CONSTRAINT "mandats_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandats" ADD CONSTRAINT "mandats_projet_vendeur_id_projets_vendeur_id_fk" FOREIGN KEY ("projet_vendeur_id") REFERENCES "public"."projets_vendeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandats" ADD CONSTRAINT "mandats_remplace_mandat_id_mandats_id_fk" FOREIGN KEY ("remplace_mandat_id") REFERENCES "public"."mandats"("id") ON DELETE no action ON UPDATE no action;