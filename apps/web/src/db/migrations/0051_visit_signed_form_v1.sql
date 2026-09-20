-- VISIT_SIGNED_FORM_V1 (ADR-063) — strictement additive : deux nouvelles tables (bons_visite,
-- signatures_bon_visite), une colonne nullable sur documents_bien (visite_id, rattachement
-- cumulatif, SET NULL), une colonne nullable sur evenements_metier (bon_visite_id) avec son index
-- unique partiel dédié. Les DROP+re-CREATE de contraintes CHECK ci-dessous ne font qu'élargir leur
-- liste de valeurs autorisées (même idiome que 0046/0047/0050) — aucune table supprimée, aucune
-- colonne retirée, aucun backfill, aucune donnée existante modifiée ou réinterprétée.
CREATE TABLE "bons_visite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visite_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"template_version" text NOT NULL,
	"contenu_snapshot" jsonb NOT NULL,
	"document_id" uuid,
	"hash_document" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"signe_le" timestamp with time zone,
	"annule_le" timestamp with time zone,
	CONSTRAINT "bons_visite_visite_version_unique" UNIQUE("visite_id","version"),
	CONSTRAINT "bons_visite_statut_check" CHECK ("bons_visite"."statut" IN ('brouillon','signe','annule')),
	CONSTRAINT "bons_visite_coherence_statut_check" CHECK ((
        ("bons_visite"."statut" = 'brouillon' AND "bons_visite"."document_id" IS NULL AND "bons_visite"."hash_document" IS NULL AND "bons_visite"."signe_le" IS NULL AND "bons_visite"."annule_le" IS NULL)
        OR ("bons_visite"."statut" = 'signe' AND "bons_visite"."document_id" IS NOT NULL AND "bons_visite"."hash_document" IS NOT NULL AND "bons_visite"."signe_le" IS NOT NULL AND "bons_visite"."annule_le" IS NULL)
        OR ("bons_visite"."statut" = 'annule' AND "bons_visite"."document_id" IS NULL AND "bons_visite"."hash_document" IS NULL AND "bons_visite"."signe_le" IS NULL AND "bons_visite"."annule_le" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "signatures_bon_visite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bon_visite_id" uuid NOT NULL,
	"contact_id" uuid,
	"role_signataire" text DEFAULT 'principal' NOT NULL,
	"nom_snapshot" text NOT NULL,
	"prenom_snapshot" text,
	"email_snapshot" text,
	"provider" text DEFAULT 'domiora' NOT NULL,
	"external_signature_id" text,
	"signature_cle_stockage" text NOT NULL,
	"consentement_confirme_le" timestamp with time zone NOT NULL,
	"signe_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signatures_bon_visite_role_check" CHECK ("signatures_bon_visite"."role_signataire" IN ('principal','secondaire')),
	CONSTRAINT "signatures_bon_visite_provider_check" CHECK ("signatures_bon_visite"."provider" IN ('domiora'))
);
--> statement-breakpoint
ALTER TABLE "documents_bien" DROP CONSTRAINT "documents_bien_type_document_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_une_seule_cible_check";--> statement-breakpoint
ALTER TABLE "documents_bien" ADD COLUMN "visite_id" uuid;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "bon_visite_id" uuid;--> statement-breakpoint
ALTER TABLE "bons_visite" ADD CONSTRAINT "bons_visite_visite_id_visites_id_fk" FOREIGN KEY ("visite_id") REFERENCES "public"."visites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bons_visite" ADD CONSTRAINT "bons_visite_document_id_documents_bien_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents_bien"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures_bon_visite" ADD CONSTRAINT "signatures_bon_visite_bon_visite_id_bons_visite_id_fk" FOREIGN KEY ("bon_visite_id") REFERENCES "public"."bons_visite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures_bon_visite" ADD CONSTRAINT "signatures_bon_visite_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_visite_id_visites_id_fk" FOREIGN KEY ("visite_id") REFERENCES "public"."visites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_bon_visite_id_bons_visite_id_fk" FOREIGN KEY ("bon_visite_id") REFERENCES "public"."bons_visite"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_bon_visite_id_unique" ON "evenements_metier" USING btree ("type_evenement","bon_visite_id") WHERE "evenements_metier"."bon_visite_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_type_document_check" CHECK ("documents_bien"."type_document" IS NULL OR "documents_bien"."type_document" IN (
        'cni','justificatif_domicile','rib',
        'titre_propriete','plan','taxe_fonciere',
        'dpe','amiante','plomb','electricite','gaz','carrez','termites','erp','assainissement',
        'reglement_copropriete','edd','pv_ag','pre_etat_date','fiche_synthetique','carnet_entretien','procedures_syndic',
        'mandat','offre_achat','compromis','avenant',
        'attestation_financement','offre_pret',
        'courrier_notaire','projet_acte',
        'bon_visite',
        'autre'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible',
        'offre_recue','offre_acceptee','offre_refusee','offre_retiree','offre_caduque',
        'compromis_realise','compromis_annule',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis',
        'visite_annulee','bon_visite_signe'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_une_seule_cible_check" CHECK ((
        (case when "evenements_metier"."compte_rendu_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."compromis_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."offre_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."mandat_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."bon_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."bien_id" is not null and "evenements_metier"."acquereur_id" is not null then 1 else 0 end)
      ) = 1);