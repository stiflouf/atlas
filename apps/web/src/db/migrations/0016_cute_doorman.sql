CREATE TABLE "notes_prospect_vendeur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_vendeur_id" uuid NOT NULL,
	"type" text DEFAULT 'note_interne' NOT NULL,
	"contenu" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_prospect_vendeur_type_check" CHECK ("notes_prospect_vendeur"."type" IN ('appel','email','sms','rendez_vous','autre_interaction','note_interne'))
);
--> statement-breakpoint
CREATE TABLE "prospects_vendeurs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"prenom" text,
	"email" text,
	"telephone" text,
	"origine_lead" text,
	"origine_lead_detail" text,
	"adresse_bien_potentiel" text,
	"secteur_bien_potentiel" text,
	"ville" text,
	"code_postal" text,
	"type_bien" text,
	"qualifie_le" timestamp with time zone,
	"estimation_proposee_centimes" integer,
	"estimation_proposee_le" date,
	"rdv_estimation_prevu_le" timestamp with time zone,
	"rdv_estimation_realise_le" timestamp with time zone,
	"mandat_propose_le" timestamp with time zone,
	"mandat_signe_le" timestamp with time zone,
	"bien_id" uuid,
	"motif_perte" text,
	"date_perte" date,
	"prochaine_action" text,
	"prochaine_action_le" date,
	"dernier_contact_le" timestamp with time zone,
	"archive_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_vendeurs_bien_id_unique" UNIQUE("bien_id"),
	CONSTRAINT "prospects_vendeurs_estimation_positive_check" CHECK ("prospects_vendeurs"."estimation_proposee_centimes" IS NULL OR "prospects_vendeurs"."estimation_proposee_centimes" > 0),
	CONSTRAINT "prospects_vendeurs_origine_lead_check" CHECK ("prospects_vendeurs"."origine_lead" IS NULL OR "prospects_vendeurs"."origine_lead" IN ('recommandation','ancien_client','site_web','reseaux_sociaux','prospection_terrain','panneau','salon_evenement','apport_affaire','autre')),
	CONSTRAINT "prospects_vendeurs_type_bien_check" CHECK ("prospects_vendeurs"."type_bien" IS NULL OR "prospects_vendeurs"."type_bien" IN ('appartement','maison','studio','loft','local_commercial')),
	CONSTRAINT "prospects_vendeurs_motif_perte_check" CHECK ("prospects_vendeurs"."motif_perte" IS NULL OR "prospects_vendeurs"."motif_perte" IN ('projet_abandonne','choix_agence_concurrente','desaccord_estimation','injoignable','bien_vendu_autrement','delai_calendrier','autre'))
);
--> statement-breakpoint
ALTER TABLE "notes_prospect_vendeur" ADD CONSTRAINT "notes_prospect_vendeur_prospect_vendeur_id_prospects_vendeurs_id_fk" FOREIGN KEY ("prospect_vendeur_id") REFERENCES "public"."prospects_vendeurs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ADD CONSTRAINT "prospects_vendeurs_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;