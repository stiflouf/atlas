-- ADR-056 — fondation IDENTITÉ EXTERNE et PROVENANCE. Migration STRICTEMENT ADDITIVE : deux
-- tables créées, AUCUNE table existante modifiée, AUCUNE colonne ajoutée au Core, AUCUN BACKFILL.
--
-- `references_externes` dit « telle entité DOMIORA correspond à telle entité chez tel
-- fournisseur ». C'est une ASSERTION d'un connecteur, pas une hypothèse : `memoire_contextuelle`
-- (scores de confiance, statut de validation, empreinte de contenu, cibles sans FK) reste INTACTE
-- et séparée, comme ADR-056 §2 le décide explicitement. `connexions_google` reste intacte aussi :
-- un jeton OAuth est un moyen d'accès, jamais une identité métier, et rien de cette couche ne
-- stocke de secret.
--
-- LES DEUX TABLES SONT RACINES (ADR-054 §7, et ADR-056 « Modèle de données »). Ce n'est pas une
-- commodité : deux workspaces peuvent légitimement recevoir le MÊME `id_externe` du MÊME
-- fournisseur sans que ce soit une collision — ils parlent à deux comptes différents. Sans
-- `workspace_id` dans la clé d'unicité, l'un écraserait l'autre.
--
-- CIBLES DÉDIÉES + `CHECK` « exactement une », et non le couple `type_entite_canonique` +
-- `id_entite_canonique` qu'esquisse ADR-056 §2 : ce couple ne peut porter aucune clé étrangère,
-- alors que la même ADR exige « FK réelle vers une entité canonique ». Un id qui ne désigne rien
-- passerait sans bruit. Même patron que `taches`, `parties_projet` et `interactions`.
--
-- `UNIQUE (workspace_id, fournisseur, type_entite_externe, id_externe)` EST l'invariant 2 : une
-- identité externe désigne au plus une entité canonique, garanti par la base et non par une
-- discipline applicative. L'inverse reste libre : une entité canonique peut porter plusieurs
-- références (invariant 3).
--
-- `champs_verrouilles` matérialise l'invariant 4 : un champ corrigé par un humain n'est jamais
-- écrasé par une synchronisation. Provenance HYBRIDE (§4, option C) — cette table ne stocke QUE les
-- exceptions ; une provenance colonne par colonne créerait un schéma fantôme aussi gros que le
-- schéma réel. Le verrou est posé par (ENTITÉ, CHAMP) et non par (entité, fournisseur) comme le
-- range le croquis de §4 : une correction humaine est un fait sur la valeur DOMIORA, et verrouiller
-- par fournisseur laisserait un second connecteur écraser ce que le premier respecte.
--
-- NON CRÉÉ, faute d'écrivain : `synchronisations_entite` (source_de_verite, mode, synchronise_le,
-- dernier_conflit_le). Sans connecteur, aucune de ces colonnes n'aurait qui l'écrive ; `mode` et
-- `source_de_verite` sont d'ailleurs des propriétés DU CONNECTEUR (§6), portées par le contrat typé.
--
-- AUCUN BACKFILL : `visites.rendez_vous_calendar_id`, `envois_email.gmail_message_id` et
-- `memoire_contextuelle` ont des sémantiques différentes (corrélation temporaire, audit technique,
-- hypothèse scorée). Les convertir en références externes affirmerait des identités que personne
-- n'a constatées. Ce sont des candidats de migration documentés, pas des données à reprendre ici.

CREATE TABLE "champs_verrouilles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"contact_id" uuid,
	"projet_acquereur_id" uuid,
	"projet_vendeur_id" uuid,
	"bien_id" uuid,
	"mandat_id" uuid,
	"champ" text NOT NULL,
	"verrouille_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "champs_verrouilles_contact_champ_unique" UNIQUE("contact_id","champ"),
	CONSTRAINT "champs_verrouilles_projet_acquereur_champ_unique" UNIQUE("projet_acquereur_id","champ"),
	CONSTRAINT "champs_verrouilles_projet_vendeur_champ_unique" UNIQUE("projet_vendeur_id","champ"),
	CONSTRAINT "champs_verrouilles_bien_champ_unique" UNIQUE("bien_id","champ"),
	CONSTRAINT "champs_verrouilles_mandat_champ_unique" UNIQUE("mandat_id","champ"),
	CONSTRAINT "champs_verrouilles_une_seule_cible_check" CHECK ((
        (case when "champs_verrouilles"."contact_id" is not null then 1 else 0 end) +
        (case when "champs_verrouilles"."projet_acquereur_id" is not null then 1 else 0 end) +
        (case when "champs_verrouilles"."projet_vendeur_id" is not null then 1 else 0 end) +
        (case when "champs_verrouilles"."bien_id" is not null then 1 else 0 end) +
        (case when "champs_verrouilles"."mandat_id" is not null then 1 else 0 end)
      ) = 1)
);
--> statement-breakpoint
CREATE TABLE "references_externes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"fournisseur" text NOT NULL,
	"type_entite_externe" text NOT NULL,
	"id_externe" text NOT NULL,
	"contact_id" uuid,
	"projet_acquereur_id" uuid,
	"projet_vendeur_id" uuid,
	"bien_id" uuid,
	"mandat_id" uuid,
	"interaction_id" uuid,
	"vue_pour_la_premiere_fois_le" timestamp with time zone DEFAULT now() NOT NULL,
	"vue_pour_la_derniere_fois_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "references_externes_identite_unique" UNIQUE("workspace_id","fournisseur","type_entite_externe","id_externe"),
	CONSTRAINT "references_externes_fournisseur_check" CHECK ("references_externes"."fournisseur" ~ '^[a-z0-9_]+$'),
	CONSTRAINT "references_externes_une_seule_cible_check" CHECK ((
        (case when "references_externes"."contact_id" is not null then 1 else 0 end) +
        (case when "references_externes"."projet_acquereur_id" is not null then 1 else 0 end) +
        (case when "references_externes"."projet_vendeur_id" is not null then 1 else 0 end) +
        (case when "references_externes"."bien_id" is not null then 1 else 0 end) +
        (case when "references_externes"."mandat_id" is not null then 1 else 0 end) +
        (case when "references_externes"."interaction_id" is not null then 1 else 0 end)
      ) = 1)
);
--> statement-breakpoint
ALTER TABLE "champs_verrouilles" ADD CONSTRAINT "champs_verrouilles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champs_verrouilles" ADD CONSTRAINT "champs_verrouilles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champs_verrouilles" ADD CONSTRAINT "champs_verrouilles_projet_acquereur_id_projets_acquereur_id_fk" FOREIGN KEY ("projet_acquereur_id") REFERENCES "public"."projets_acquereur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champs_verrouilles" ADD CONSTRAINT "champs_verrouilles_projet_vendeur_id_projets_vendeur_id_fk" FOREIGN KEY ("projet_vendeur_id") REFERENCES "public"."projets_vendeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champs_verrouilles" ADD CONSTRAINT "champs_verrouilles_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champs_verrouilles" ADD CONSTRAINT "champs_verrouilles_mandat_id_mandats_id_fk" FOREIGN KEY ("mandat_id") REFERENCES "public"."mandats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_projet_acquereur_id_projets_acquereur_id_fk" FOREIGN KEY ("projet_acquereur_id") REFERENCES "public"."projets_acquereur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_projet_vendeur_id_projets_vendeur_id_fk" FOREIGN KEY ("projet_vendeur_id") REFERENCES "public"."projets_vendeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_mandat_id_mandats_id_fk" FOREIGN KEY ("mandat_id") REFERENCES "public"."mandats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references_externes" ADD CONSTRAINT "references_externes_interaction_id_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."interactions"("id") ON DELETE no action ON UPDATE no action;