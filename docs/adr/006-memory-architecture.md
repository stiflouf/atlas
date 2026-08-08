# ADR-006 — Memory Architecture

**Statut :** Accepté
**Date :** 2026-08-08
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Depuis le Sprint 3, Atlas calcule une correspondance métier (bien/client/type) pour chaque
rendez-vous Google Calendar, mais ne retient rien d'une consultation à l'autre : le moteur de
matching retourne le même résultat à chaque chargement, et une validation humaine ("Oui",
"Choisir un autre bien", "Ignorer") ne survit pas à un rafraîchissement de page. Le refresh
token Google est par ailleurs stocké dans un cookie navigateur — fonctionnel, mais ce n'est pas
là qu'un secret de cette nature doit vivre.

PostgreSQL est déjà la base de données cible du produit (ADR-003). Ce sprint l'introduit dès
maintenant côté `apps/web`, avant l'existence d'`apps/api`, parce que les limites qui restent
(pas de mémoire des décisions humaines, secret dans le navigateur, recalcul systématique) ne se
résolvent plus sans persistance.

## Décision

### Pas de multi-utilisateur

Atlas reste un produit mono-conseiller. Aucune table `utilisateurs`, aucune session, aucune
clé étrangère liée à un utilisateur. La connexion Google est un fait global de l'application,
pas un état par navigateur : `connexions_google` est une table à une seule ligne possible
(`id = 'default'`). Le navigateur ne conserve plus aucun secret Google — il n'a d'ailleurs plus
besoin de cookie du tout pour cet usage, puisqu'il n'y a rien à distinguer entre deux visiteurs.

Cette simplicité est délibérée : introduire un modèle utilisateur/session maintenant créerait de
la complexité pour un besoin qui n'existe pas encore. À réévaluer le jour où Atlas doit
réellement distinguer plusieurs conseillers.

### Mémoire générique, pas une table par connecteur

`memoire_contextuelle` ne s'appelle pas `rendez_vous_contextes` : elle porte `source`
(`google_calendar`, et demain `gmail`, `sms`, `whatsapp`, `document`, ...) et `type_element`
(`evenement`, `email`, `message`, `document`, ...) comme colonnes génériques, avec
`identifiant_externe` plutôt qu'un identifiant spécifique au calendrier. Ajouter un connecteur
ne crée jamais de nouvelle table : seulement de nouvelles lignes avec un `source`/`type_element`
différents. Ce sprint n'écrit et ne lit que des lignes `source = 'google_calendar'` — la
généricité est validée par la conception, pas encore exercée par d'autres connecteurs
(conformément à ADR-005 : on n'ajoute pas de connecteur avant d'en avoir besoin).

`bien_id` et `client_id` restent des références texte vers les catalogues mockés
(`data/biens.ts`, `data/clients.ts`) — pas de clé étrangère, pas de table `biens`/`clients` en
base. Gérer ces catalogues en base n'est pas nécessaire pour ce sprint (hors périmètre).

### Priorité : validation humaine > cache > moteur de matching

Pour un élément externe donné, dans cet ordre :

1. Une ligne existe avec `statut_validation IN ('confirme', 'corrige')` → la décision humaine
   est utilisée telle quelle, sans condition. Une correction humaine a toujours priorité sur le
   moteur déterministe, y compris si l'événement source change ensuite.
2. Une ligne existe avec `statut_validation = 'auto'` → on compare l'empreinte stockée à
   l'empreinte actuelle de l'élément (SHA-256 des champs réellement utilisés par le matching :
   statut, titre, lieu, début, fin — pas le champ `updated` de Google, qui bouge pour des
   raisons sans rapport avec le matching). Identique → le résultat est réutilisé sans recalcul.
   Différente → le moteur est relancé, la ligne est mise à jour.
3. Aucune ligne → le moteur calcule, une ligne `statut_validation = 'auto'` est insérée.

`statut_validation = 'ignore'` est terminal : aucune nouvelle sollicitation du conseiller.

### Accès aux données : Drizzle ORM

Drizzle plutôt que Prisma : pas de moteur de requêtes séparé (juste une fine couche sur
`postgres.js`), une DSL TypeScript qui reste très proche du SQL généré, cohérent avec la
préférence déjà établie pour des dépendances minimales (ADR sur les intégrations : fetch natif
plutôt que SDK Google). Les migrations générées sont du SQL Postgres portable, commité dans le
repo — **c'est ce SQL, pas la définition Drizzle, qui fait foi du schéma physique.**

`apps/web` est propriétaire du schéma et des migrations tant qu'`apps/api` n'existe pas — comme
`apps/web` a déjà joué le rôle du connecteur Google Calendar avant l'existence d'`apps/worker`
(ADR-005). **Quand `apps/api` (FastAPI/SQLAlchemy/Alembic) sera créé, la propriété des
migrations doit lui être transférée** : Alembic devient l'outil de migration, SQLAlchemy
reflète les tables existantes. Ce transfert n'est pas fait maintenant — il est documenté ici
pour ne pas être une surprise.

## Alternatives écartées

**Table `rendez_vous_contextes` spécifique au calendrier :** aurait fonctionné pour ce sprint,
mais aurait imposé une nouvelle table à chaque connecteur (Gmail, SMS, WhatsApp...) — exactement
ce qu'on veut éviter.

**Découper en deux tables (élément externe / correspondance métier) :** séparation plus
"propre" en théorie, mais résout un problème qui n'existe pas encore (aucun besoin de
correspondances multiples pour un même élément, aucun attribut spécifique par type d'élément).
Une seule table générique suffit ; le découpage pourra être introduit si un besoin réel
apparaît.

**Modèle utilisateur/session dès maintenant :** écarté (voir ci-dessus).

**Prisma :** écarté pour le poids du runtime (moteur de requêtes séparé), pas pour un problème
de portabilité — ses migrations SQL sont tout aussi lisibles que celles de Drizzle.

## Conséquences

- Le refresh_token Google n'est plus jamais transmis au navigateur — il est chiffré
  (AES-256-GCM, `GOOGLE_TOKEN_ENCRYPTION_KEY`) et stocké dans `connexions_google`.
- Une correction humaine sur un rendez-vous ambigu est désormais définitive tant que le
  conseiller ne la change pas explicitement.
- Un événement Google inchangé ne déclenche plus de recalcul du matching à chaque chargement.
- Le jour où un deuxième conseiller doit utiliser Atlas, `connexions_google` et
  `memoire_contextuelle` devront gagner une notion d'utilisateur — actuellement absente par
  choix, pas par oubli.
- Le jour où `apps/api` existe, la propriété du schéma Postgres doit être réévaluée (voir
  ci-dessus) — cette ADR sert de rappel explicite.
