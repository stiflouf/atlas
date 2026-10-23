-- LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — registre des suspensions de suppression.
--
-- STRICTEMENT ADDITIVE : un CREATE TABLE, une FK, deux index, cinq CHECK. Aucune table métier n'est
-- touchée, aucune colonne n'est ajoutée ailleurs, aucun DROP, aucun DELETE, aucun UPDATE, aucun
-- INSERT, aucun backfill, aucun trigger. La table sort de cette migration VIDE : un hold est un acte
-- humain documenté, jamais une ligne fabriquée par une migration.
--
-- CE QUE CETTE TABLE FAIT : elle INTERDIT. Elle n'autorise rien, ne supprime rien et n'est lue par
-- aucun chemin destructif — il n'en existe aucun dans le produit (`APPLY_SUPPORTED = false`,
-- `RETENTION_ENFORCEMENT_V1_LIVRE = false`). Son unique consommateur est le CALCUL d'éligibilité du
-- dry-run de rétention, qui en déduit un verdict `BLOCKED_BY_LEGAL_HOLD` au lieu d'`ELIGIBLE`.
--
-- RACINE (ADR-054) : `workspace_id` est porté ici. Un hold n'est pas une feuille de `bons_visite` —
-- cette table-là ne porte elle-même aucune appartenance (feuille de `visites -> biens`) — mais un
-- acte d'administration du workspace, comme `runs_retention`.
--
-- AUCUNE FK VERS LA RESSOURCE PROTÉGÉE, et c'est le point de conception de cette migration :
--   * `ON DELETE cascade` ferait disparaître l'historique du hold avec sa ressource ;
--   * `ON DELETE no action` protégerait la ressource en SQL, mais protégerait AUSSI pour toujours
--     une ressource dont le hold a été LEVÉ (la ligne reste, par immutabilité du registre), ce qui
--     rendrait la levée sans effet ;
--   * `entity_type` + `entity_id` suivent donc le précédent d'`actions_retention`, et l'existence de
--     la cible est prouvée à la POSE par une lecture scopée au workspace.
--
-- `entity_type` n'admet que `'bons_visite'` : le seul type pour lequel une politique déclare
-- `legalHoldApplicable: true` (SIGNED_VISIT_FORM, ADR-065) ET dont le moteur consulte réellement les
-- holds. Un vocabulaire ouvert aurait permis de poser un hold qu'aucun chemin ne lit — une
-- protection qui n'en est pas une. Le lot qui supportera un second type élargira ce CHECK par
-- migration, ce qui le rendra visible et daté.
--
-- ÉTAT DÉRIVÉ, jamais stocké : actif <=> `leve_le IS NULL`. Aucune colonne `statut` en plus de ces
-- dates, qui serait une seconde vérité — et le jour où les deux divergeraient, c'est la plus
-- permissive qui piloterait une purge.
--
-- UNICITÉ portée par la BASE (`legal_holds_cible_actif_unique`, index unique PARTIEL sur les seuls
-- holds actifs) : deux poses simultanées du même hold ne peuvent pas aboutir toutes les deux, quel
-- que soit l'entrelacement, et une levée n'empêche jamais une nouvelle pose ultérieure. La clé inclut
-- `motif_code` à dessein : plusieurs motifs peuvent protéger la même ressource en même temps, et
-- lever l'un ne doit pas lever l'autre.
--
-- Ce que cette table ne doit JAMAIS contenir : nom, prénom, email, téléphone, adresse, contenu de
-- document, image de signature. `pose_par_identite_sub` est le `sub` OIDC (ADR-047), identifiant
-- stable et non une coordonnée. `motif` est un texte MOTIVÉ par un opérateur : il décrit une
-- affaire, et il lui appartient de ne pas y recopier la donnée protégée.

CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"motif_code" text NOT NULL,
	"motif" text NOT NULL,
	"pose_le" timestamp with time zone DEFAULT now() NOT NULL,
	"pose_par_identite_sub" text NOT NULL,
	"leve_le" timestamp with time zone,
	"leve_par_identite_sub" text,
	"motif_levee" text,
	"ordre" bigint GENERATED ALWAYS AS IDENTITY (sequence name "legal_holds_ordre_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "legal_holds_entity_type_check" CHECK ("legal_holds"."entity_type" IN ('bons_visite')),
	CONSTRAINT "legal_holds_motif_code_check" CHECK ("legal_holds"."motif_code" IN (
        'CONTENTIEUX','PRE_CONTENTIEUX','OBLIGATION_CONSERVATION',
        'CONTROLE_OU_AUDIT','DEMANDE_JURIDIQUE','AUTRE_MOTIF_DOCUMENTE'
      )),
	CONSTRAINT "legal_holds_motif_non_vide_check" CHECK (length(btrim("legal_holds"."motif")) >= 10),
	CONSTRAINT "legal_holds_coherence_levee_check" CHECK (("legal_holds"."leve_le" IS NULL AND "legal_holds"."leve_par_identite_sub" IS NULL AND "legal_holds"."motif_levee" IS NULL)
        OR ("legal_holds"."leve_le" IS NOT NULL AND "legal_holds"."leve_par_identite_sub" IS NOT NULL
            AND "legal_holds"."motif_levee" IS NOT NULL AND length(btrim("legal_holds"."motif_levee")) >= 10)),
	CONSTRAINT "legal_holds_levee_apres_pose_check" CHECK ("legal_holds"."leve_le" IS NULL OR "legal_holds"."leve_le" >= "legal_holds"."pose_le")
);
--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_holds_cible_actif_unique" ON "legal_holds" USING btree ("workspace_id","entity_type","entity_id","motif_code") WHERE "legal_holds"."leve_le" IS NULL;--> statement-breakpoint
CREATE INDEX "legal_holds_cible_idx" ON "legal_holds" USING btree ("workspace_id","entity_type","entity_id");