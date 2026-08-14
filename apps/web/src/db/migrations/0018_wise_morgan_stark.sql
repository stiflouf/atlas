ALTER TABLE "biens" ADD COLUMN "nom_copropriete" text;--> statement-breakpoint
ALTER TABLE "biens" ADD COLUMN "charge_honoraires" text;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "type_document" text;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "type_document_detail" text;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "date_document" date;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "date_fin_validite" date;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "compromis_id" uuid;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "acquereur_id" uuid;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "prospect_vendeur_id" uuid;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "copropriete_declaree" text;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "adresse_declaree" text;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "provenance" text;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "etat_verification" text DEFAULT 'non_verifie' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "modifie_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_compromis_id_compromis_id_fk" FOREIGN KEY ("compromis_id") REFERENCES "public"."compromis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_prospect_vendeur_id_prospects_vendeurs_id_fk" FOREIGN KEY ("prospect_vendeur_id") REFERENCES "public"."prospects_vendeurs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biens" ADD CONSTRAINT "biens_charge_honoraires_check" CHECK ("biens"."charge_honoraires" IS NULL OR "biens"."charge_honoraires" IN ('vendeur','acquereur'));--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_type_document_check" CHECK ("documents_bien"."type_document" IS NULL OR "documents_bien"."type_document" IN (
        'cni','justificatif_domicile','rib',
        'titre_propriete','plan','taxe_fonciere',
        'dpe','amiante','plomb','electricite','gaz','carrez','termites','erp','assainissement',
        'reglement_copropriete','edd','pv_ag','pre_etat_date','fiche_synthetique','carnet_entretien','procedures_syndic',
        'mandat','offre_achat','compromis','avenant',
        'attestation_financement','offre_pret',
        'courrier_notaire','projet_acte',
        'autre'
      ));--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_etat_verification_check" CHECK ("documents_bien"."etat_verification" IN ('non_verifie','confirme','a_verifier','rejete'));