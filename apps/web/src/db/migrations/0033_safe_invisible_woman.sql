-- ADR-054 — retrait du filet de migration posé par 0032. Tous les chemins d'écriture des 9 tables
-- racines posent désormais `workspace_id` explicitement, depuis la session (`exigerWorkspaceCourant`)
-- ou depuis le contexte d'exécution machine (`resoudreWorkspaceExecutionMachine`).
--
-- Ce n'est pas un nettoyage cosmétique mais un INVARIANT DE SÉCURITÉ : tant que le DEFAULT existait,
-- une écriture qui oubliait l'appartenance était silencieusement rangée dans le workspace historique.
-- Elle échoue désormais immédiatement (violation NOT NULL), au plus près de l'erreur.
--
-- `NOT NULL` et la clé étrangère vers `workspaces(id)` restent en place et ne sont JAMAIS retirés.
-- Aucune donnée historique n'est touchée : les lignes existantes conservent la valeur déjà backfillée
-- par 0032.

ALTER TABLE "acquereurs" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "biens" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "compatibilites_a_resynchroniser" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "envois_email" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "evenements_metier" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prospects_vendeurs" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "runs_scan_automatisation" ALTER COLUMN "workspace_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "taches" ALTER COLUMN "workspace_id" DROP DEFAULT;