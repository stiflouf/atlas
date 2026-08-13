CREATE TABLE "dossier_fiscal" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historique_amorcage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_fiscal_id" text NOT NULL,
	"annee" integer NOT NULL,
	"montant_encaisse_centimes" integer NOT NULL,
	"date_fin_couverture" date NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone,
	CONSTRAINT "historique_amorcage_dossier_annee_unique" UNIQUE("dossier_fiscal_id","annee"),
	CONSTRAINT "historique_amorcage_montant_positif_check" CHECK ("historique_amorcage"."montant_encaisse_centimes" >= 0),
	CONSTRAINT "historique_amorcage_date_fin_couverture_annee_check" CHECK (extract(year from "historique_amorcage"."date_fin_couverture") = "historique_amorcage"."annee")
);
--> statement-breakpoint
CREATE TABLE "profil_fiscal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_fiscal_id" text NOT NULL,
	"date_debut_validite" date NOT NULL,
	"nature_activite" text DEFAULT 'agent_commercial_immobilier' NOT NULL,
	"date_debut_activite" date NOT NULL,
	"regime_fiscal" text NOT NULL,
	"regime_comptable" text,
	"regime_tva" text NOT NULL,
	"option_debits" boolean,
	"periodicite_urssaf" text NOT NULL,
	"option_versement_liberatoire" boolean,
	"acre_actif" boolean,
	"acre_date_debut" date,
	"acre_date_fin" date,
	"affiliation_retraite" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profil_fiscal_nature_activite_check" CHECK ("profil_fiscal"."nature_activite" IN ('agent_commercial_immobilier')),
	CONSTRAINT "profil_fiscal_regime_fiscal_check" CHECK ("profil_fiscal"."regime_fiscal" IN ('micro_bnc','declaration_controlee','inconnu')),
	CONSTRAINT "profil_fiscal_regime_comptable_check" CHECK ("profil_fiscal"."regime_comptable" IS NULL OR "profil_fiscal"."regime_comptable" IN ('caisse','engagement','inconnu')),
	CONSTRAINT "profil_fiscal_regime_tva_check" CHECK ("profil_fiscal"."regime_tva" IN ('franchise','redevable_reel_simplifie','redevable_reel_normal','inconnu')),
	CONSTRAINT "profil_fiscal_periodicite_urssaf_check" CHECK ("profil_fiscal"."periodicite_urssaf" IN ('mensuelle','trimestrielle','inconnu')),
	CONSTRAINT "profil_fiscal_affiliation_retraite_check" CHECK ("profil_fiscal"."affiliation_retraite" IN ('ssi_regime_general','cipav','inconnu'))
);
--> statement-breakpoint
CREATE TABLE "regle_fiscale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"categorie_activite" text NOT NULL,
	"valeur" integer NOT NULL,
	"unite" text NOT NULL,
	"date_debut_validite" date NOT NULL,
	"date_fin_validite" date,
	"source_libelle" text NOT NULL,
	"source_url" text NOT NULL,
	"date_publication_source" date,
	"statut_verification" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regle_fiscale_code_categorie_debut_unique" UNIQUE("code","categorie_activite","date_debut_validite"),
	CONSTRAINT "regle_fiscale_unite_check" CHECK ("regle_fiscale"."unite" IN ('centimes','points_base','jours')),
	CONSTRAINT "regle_fiscale_statut_verification_check" CHECK ("regle_fiscale"."statut_verification" IN ('verifie_direct','recoupement','a_confirmer')),
	CONSTRAINT "regle_fiscale_periode_check" CHECK ("regle_fiscale"."date_fin_validite" IS NULL OR "regle_fiscale"."date_fin_validite" > "regle_fiscale"."date_debut_validite")
);
--> statement-breakpoint
CREATE TABLE "rfr_foyer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_fiscal_id" text NOT NULL,
	"annee_rfr" integer NOT NULL,
	"rfr_foyer_centimes" integer NOT NULL,
	"nombre_parts_centiemes" integer NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone,
	CONSTRAINT "rfr_foyer_dossier_annee_unique" UNIQUE("dossier_fiscal_id","annee_rfr"),
	CONSTRAINT "rfr_foyer_montant_positif_check" CHECK ("rfr_foyer"."rfr_foyer_centimes" >= 0),
	CONSTRAINT "rfr_foyer_parts_positif_check" CHECK ("rfr_foyer"."nombre_parts_centiemes" > 0)
);
--> statement-breakpoint
ALTER TABLE "historique_amorcage" ADD CONSTRAINT "historique_amorcage_dossier_fiscal_id_dossier_fiscal_id_fk" FOREIGN KEY ("dossier_fiscal_id") REFERENCES "public"."dossier_fiscal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_fiscal" ADD CONSTRAINT "profil_fiscal_dossier_fiscal_id_dossier_fiscal_id_fk" FOREIGN KEY ("dossier_fiscal_id") REFERENCES "public"."dossier_fiscal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfr_foyer" ADD CONSTRAINT "rfr_foyer_dossier_fiscal_id_dossier_fiscal_id_fk" FOREIGN KEY ("dossier_fiscal_id") REFERENCES "public"."dossier_fiscal"("id") ON DELETE cascade ON UPDATE no action;