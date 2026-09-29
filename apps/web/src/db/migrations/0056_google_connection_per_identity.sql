-- ATTENTION — ce fichier est ÉCRIT À LA MAIN, même précédent que 0032 et 0055. `drizzle-kit
-- generate` ne peut pas le produire seul : il voit une colonne `id` qui disparaît et une colonne
-- `identite_sub` qui apparaît, et demande interactivement s'il s'agit d'un RENOMMAGE. La réponse
-- est NON, et elle est structurante — renommer conserverait la ligne legacy et attribuerait son
-- refresh token à une identité nommée `'default'`, c'est-à-dire à personne. Ne jamais régénérer ce
-- fichier en répondant « rename ».
--
-- WORKSPACE_SCOPING_V2D2 (ADR-054 §6) — `connexions_google` passe du SINGLETON D'INSTANCE
-- (PRIMARY KEY `id` DEFAULT 'default', une ligne pour tout le monde) à UNE LIGNE PAR IDENTITÉ
-- (PRIMARY KEY `identite_sub`).
--
-- Ce que le singleton cassait, concrètement : le second membre qui connectait Google écrasait le
-- refresh token du premier (`ON CONFLICT (id)`), le premier logout révoquait l'accès de tout le
-- monde, et tout appel Calendar/Gmail de n'importe quelle session lisait le compte du DERNIER
-- connecté. Aucune requête ne pouvait distinguer deux personnes : il n'y avait qu'une ligne.
--
-- `identite_sub` est le `sub` OIDC de la session Atlas (ADR-047) : stable, non modifiable, déjà la
-- clé d'appartenance (`workspace_membres.identite_sub`). JAMAIS l'email — mutable côté fournisseur,
-- et un changement d'adresse ne doit pas orpheliner un token. JAMAIS le workspace : ADR-054 §6 pose
-- qu'un secret personnel ne devient jamais un actif partagé, et la garde structurelle
-- `TABLES_PRIVEES_IDENTITE` le vérifie.
--
-- AUCUNE FK : il n'existe pas de table d'utilisateurs, et `workspace_membres.identite_sub` n'est pas
-- unique (PK composite avec le workspace). Une FK vers elle rattacherait ce secret à une
-- APPARTENANCE, pas à une personne — précisément ce que §6 refuse.
--
-- ── STRATÉGIE LEGACY : DROP_AND_RECONNECT, et pourquoi PAS un backfill ──
--
-- La migration 0055 a rattaché ses lignes au workspace historique, parce qu'une seule appartenance
-- était possible avant elle. Le même raisonnement serait tentant ici — un seul membre, donc un seul
-- propriétaire possible — et il est REFUSÉ, pour deux raisons qui n'existaient pas en 0055 :
--
--   1. l'objet est un SECRET. Un rattachement erroné ne produirait pas un cache faux, il donnerait
--      à quelqu'un l'accès à l'agenda et à la boîte Gmail d'un autre. Le coût d'une erreur n'est
--      pas du même ordre, donc le niveau de preuve exigé non plus ;
--   2. l'inférence est plus faible qu'elle n'en a l'air. RIEN en base ne relie cette ligne à la
--      personne qui a cliqué « Connecter Google » : `connexions_google` n'a jamais porté ni `sub`,
--      ni email, ni même l'adresse du compte Google autorisé (aucun scope `openid`/`email` n'est
--      demandé). On ne pourrait que SUPPOSER que c'est l'unique membre enregistré.
--
-- La ligne legacy est donc SUPPRIMÉE. Le coût réel est d'un clic, une fois, pour un seul
-- utilisateur : le parcours de reconnexion existe déjà (`/api/auth/google/login?reconnexion=1`,
-- qui force un nouveau consentement donc un nouveau refresh_token).
--
-- AUCUNE RÉVOCATION ICI : une migration n'appelle jamais le réseau. Le refresh token supprimé reste
-- techniquement valide chez Google jusqu'à expiration — ce n'est pas une fuite (plus personne ne le
-- détient), mais le geste propre est de cliquer « Déconnecter » AVANT de déployer. Voir le runbook.

-- 1. La ligne legacy part AVANT toute contrainte : `identite_sub` est NOT NULL sans DEFAULT, une
--    ligne subsistante ferait échouer l'ADD COLUMN sans qu'aucune valeur honnête puisse la sauver.
DELETE FROM "connexions_google";--> statement-breakpoint

-- 2. La table est désormais vide : l'ADD COLUMN NOT NULL ne peut plus échouer, et la PK peut être
--    déplacée sans reconstruire d'index sur des données.
ALTER TABLE "connexions_google" DROP CONSTRAINT "connexions_google_pkey";--> statement-breakpoint
ALTER TABLE "connexions_google" ADD COLUMN "identite_sub" text NOT NULL;--> statement-breakpoint
ALTER TABLE "connexions_google" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "connexions_google" ADD CONSTRAINT "connexions_google_pkey" PRIMARY KEY ("identite_sub");
