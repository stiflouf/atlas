-- RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — état de quarantaine de rétention.
--
-- STRICTEMENT ADDITIVE : un CREATE TABLE, une FK, deux index, sept CHECK. Aucune table métier n'est
-- touchée, aucune colonne n'est ajoutée ailleurs, aucun DROP, aucun DELETE, aucun UPDATE, aucun
-- INSERT, aucun backfill, aucun trigger, aucun cron. La table sort de cette migration VIDE et le
-- reste à la fin du lot : aucun chemin du produit n'ouvre de quarantaine, le dry-run de rétention
-- est LECTEUR SEUL de cette table.
--
-- CE QUE LA QUARANTAINE N'EST PAS : elle ne déplace aucun fichier, ne cache rien à l'utilisateur,
-- n'archive pas la ressource métier, ne modifie pas son contenu, ne supprime ni ligne ni fichier,
-- n'anonymise rien et ne démarre aucun compte à rebours destructif. C'est un ÉTAT DE RÉTENTION
-- auditable, et rien d'autre. `APPLY_SUPPORTED` reste false, `RETENTION_ENFORCEMENT_V1_LIVRE` reste
-- false.
--
-- `revalidation_due_le` NE SIGNIFIE PAS « supprimable à partir de ». C'est la date à partir de
-- laquelle une REVALIDATION est EXIGÉE : politique toujours applicable, cible toujours présente,
-- aucun legal hold actif. Un modèle où une date atteinte rendrait une donnée supprimable
-- transformerait un oubli de relecture en suppression automatique — c'est exactement ce que cette
-- migration refuse de rendre exprimable. Aucune valeur d'aucun vocabulaire de ce lot ne signifie
-- « purge autorisée ».
--
-- La colonne est NOT NULL et SANS DEFAUT parce qu'AUCUNE durée de quarantaine n'est décidée dans le
-- produit (QUARANTINE_DURATION_POLICY = UNDECIDED). L'échéance est donc toujours fournie
-- explicitement, jamais dérivée de la durée de CONSERVATION : cinq ans après signature est une
-- règle de conservation (ADR-065), pas une autorisation de purge, et confondre les deux serait la
-- faute la plus coûteuse de ce domaine.
--
-- RACINE (ADR-054 §7), même raisonnement que `legal_holds` : la cible est générique
-- (`entity_type` + `entity_id` en texte) et `bons_visite` ne porte lui-même aucune appartenance
-- (feuille de `visites -> biens`). Le périmètre est donc porté ici.
--
-- AUCUNE FK VERS LA RESSOURCE, pour les deux raisons d'ADR-068 : une `cascade` effacerait
-- l'historique avec la ressource ; une `no action` retiendrait pour toujours une ressource dont la
-- quarantaine a été LEVÉE, puisque la ligne reste par immutabilité du registre. L'existence de la
-- cible dans le workspace est prouvée à l'ENTRÉE par une lecture scopée, et REVÉRIFIÉE à chaque
-- revalidation.
--
-- AUCUNE FK VERS `runs_retention` : rattacher un état de longue durée à une ligne de journal ferait
-- dériver son appartenance d'un balayage ancien, et aucun consommateur ne le demande.
--
-- `policy_code` est restreint à la seule politique dont l'échéance est calculable aujourd'hui
-- (SIGNED_VISIT_FORM, `COMPUTABLE_DRY_RUN_ONLY`, ADR-066). Une politique bloquée ne peut produire
-- aucun candidat : l'accepter permettrait d'ouvrir une quarantaine que rien ne justifie.
--
-- ÉTAT DÉRIVÉ, jamais stocké (ADR-012) : `levee_le IS NOT NULL` -> LEVEE ; sinon
-- `revalidation_due_le <= maintenant` -> REVALIDATION_REQUISE ; sinon EN_QUARANTAINE. Une colonne
-- d'état en plus de ces dates serait une seconde vérité, et la plus permissive des deux finirait
-- par décider d'une purge.
--
-- SORTIE NON DESTRUCTIVE : lever une quarantaine est un UPDATE qui renseigne quatre colonnes, jamais
-- un DELETE de la ligne. Un `DELETE` comme mécanisme de sortie effacerait la trace de ce qui a été
-- envisagé puis abandonné — précisément ce qu'un registre de rétention doit conserver.
--
-- Ce que cette table ne doit JAMAIS contenir : nom, prénom, email, téléphone, adresse, contenu de
-- document, image de signature. `entre_par_identite_sub` est un `sub` OIDC (ADR-047), identifiant
-- stable et non une coordonnée.

CREATE TABLE "retention_quarantines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_code" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"motif" text NOT NULL,
	"entre_le" timestamp with time zone DEFAULT now() NOT NULL,
	"entre_par_identite_sub" text NOT NULL,
	"revalidation_due_le" timestamp with time zone NOT NULL,
	"levee_le" timestamp with time zone,
	"levee_par_identite_sub" text,
	"cause_levee" text,
	"motif_levee" text,
	"ordre" bigint GENERATED ALWAYS AS IDENTITY (sequence name "retention_quarantines_ordre_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "retention_quarantines_policy_code_check" CHECK ("retention_quarantines"."policy_code" IN ('SIGNED_VISIT_FORM')),
	CONSTRAINT "retention_quarantines_entity_type_check" CHECK ("retention_quarantines"."entity_type" IN ('bons_visite')),
	CONSTRAINT "retention_quarantines_motif_non_vide_check" CHECK (length(btrim("retention_quarantines"."motif")) >= 10),
	CONSTRAINT "retention_quarantines_cause_levee_check" CHECK ("retention_quarantines"."cause_levee" IS NULL OR "retention_quarantines"."cause_levee" IN (
        'DECISION_MANUELLE','POLITIQUE_NON_APPLICABLE','CIBLE_DISPARUE','LEGAL_HOLD_POSE'
      )),
	CONSTRAINT "retention_quarantines_coherence_levee_check" CHECK (("retention_quarantines"."levee_le" IS NULL AND "retention_quarantines"."levee_par_identite_sub" IS NULL
           AND "retention_quarantines"."cause_levee" IS NULL AND "retention_quarantines"."motif_levee" IS NULL)
        OR ("retention_quarantines"."levee_le" IS NOT NULL AND "retention_quarantines"."levee_par_identite_sub" IS NOT NULL
            AND "retention_quarantines"."cause_levee" IS NOT NULL
            AND "retention_quarantines"."motif_levee" IS NOT NULL AND length(btrim("retention_quarantines"."motif_levee")) >= 10)),
	CONSTRAINT "retention_quarantines_levee_apres_entree_check" CHECK ("retention_quarantines"."levee_le" IS NULL OR "retention_quarantines"."levee_le" >= "retention_quarantines"."entre_le"),
	CONSTRAINT "retention_quarantines_echeance_apres_entree_check" CHECK ("retention_quarantines"."revalidation_due_le" >= "retention_quarantines"."entre_le")
);
--> statement-breakpoint
ALTER TABLE "retention_quarantines" ADD CONSTRAINT "retention_quarantines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retention_quarantines_cible_active_unique" ON "retention_quarantines" USING btree ("workspace_id","entity_type","entity_id","policy_code") WHERE "retention_quarantines"."levee_le" IS NULL;--> statement-breakpoint
CREATE INDEX "retention_quarantines_cible_idx" ON "retention_quarantines" USING btree ("workspace_id","entity_type","entity_id");