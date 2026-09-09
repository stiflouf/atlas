-- ADR-055 §G — l'INTERACTION canonique : un échange humain avec une personne. Migration
-- STRICTEMENT ADDITIVE : une seule table créée, aucune table existante touchée, AUCUN BACKFILL.
--
-- AUCUNE FUSION (ADR-055 §G, point 1). `comptes_rendus_visite`, `notes_prospect_vendeur` et
-- `envois_email` restent INTACTS, avec leurs CHECK, leurs FK et leurs invariants : le vocabulaire
-- contrôlé d'`interet` est lu par des moteurs, le `type` d'une note vendeur conditionne
-- `dernier_contact_le` (ADR-027 §4), et `envois_email` est un audit technique (ADR-031-bis), jamais
-- un fait CRM. Cette table comble un VIDE — il n'existait aucune table d'interaction côté
-- contact/acquéreur — elle ne généralise rien.
--
-- AUCUN BACKFILL, et c'est la décision la plus importante ici : convertir les notes, emails et
-- comptes rendus historiques en interactions fabriquerait précisément les doublons que le futur
-- connecteur Gmail/Calendar rendrait indémêlables (le même échange, importé une fois et converti
-- une fois, sans provenance pour les rapprocher). L'import viendra avec ADR-056 et sa provenance.
--
-- FEUILLE de `contacts` (ADR-054 §7) : `contact_id` NOT NULL, aucun `workspace_id` dupliqué. Le
-- contact est obligatoire — une interaction sans personne ne décrit aucune relation.
--
-- CONTEXTE : cibles dédiées + `CHECK` « AU PLUS une », patron `taches` — jamais un couple
-- polymorphe {contexte_type, contexte_id}. « Au plus » : un appel de courtoisie sans dossier reste
-- un fait valide.
--
-- `survenu_le` NOT NULL est la date MÉTIER du fait, distincte de `cree_le` (quand DOMIORA l'a su) :
-- un import futur enregistrera des échanges vieux de six mois, et les dater d'aujourd'hui
-- inventerait une chronologie.
--
-- AUCUN IDENTIFIANT FOURNISSEUR (ADR-056) : ni `gmail_message_id`, ni `calendar_event_id`. Aucun
-- payload brut : du texte, jamais du JSON Google.

CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" text NOT NULL,
	"sens" text,
	"survenu_le" timestamp with time zone NOT NULL,
	"contenu" text,
	"projet_acquereur_id" uuid,
	"projet_vendeur_id" uuid,
	"bien_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interactions_type_check" CHECK ("interactions"."type" IN ('appel','email','sms','rendez_vous','message','note')),
	CONSTRAINT "interactions_sens_check" CHECK ("interactions"."sens" IS NULL OR "interactions"."sens" IN ('entrant','sortant','interne')),
	CONSTRAINT "interactions_un_seul_contexte_check" CHECK ((
        (case when "interactions"."projet_acquereur_id" is not null then 1 else 0 end) +
        (case when "interactions"."projet_vendeur_id" is not null then 1 else 0 end) +
        (case when "interactions"."bien_id" is not null then 1 else 0 end)
      ) <= 1)
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_projet_acquereur_id_projets_acquereur_id_fk" FOREIGN KEY ("projet_acquereur_id") REFERENCES "public"."projets_acquereur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_projet_vendeur_id_projets_vendeur_id_fk" FOREIGN KEY ("projet_vendeur_id") REFERENCES "public"."projets_vendeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;