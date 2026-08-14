# ADR-031-bis — Envoi Gmail réel avec validation humaine

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Audit de l'intégration Google réelle (`src/lib/google/*`, `src/app/api/auth/google/*`) et du
moteur ADR-031 avant d'ajouter un véritable envoi. Confirmé : l'intégration Google existante est
strictement Calendar, scope `calendar.events.readonly`, lecture seule ; aucun scope Gmail n'a
jamais été demandé. Le refresh token est chiffré (AES-256-GCM), jamais l'access token n'est
persisté. La révocation Google est **globale par construction** (un refresh token couvre l'union
des scopes accordés) — pas contournable côté Atlas.

Deux tours de plan ont validé la direction avec des corrections intégrées ci-dessous avant codage,
notamment : conserver l'autorisation incrémentale (`gmail.send` seul + `include_granted_scopes`)
plutôt qu'une union de scopes codée en dur, remplacer une garde temporelle arbitraire par une
empreinte de contenu (`contenuHash`, jamais utilisée pour bloquer), et séparer `incertain` d'`echec`
pour les résultats ambigus (timeout/rupture réseau après déclenchement de l'envoi).

## Décision

### 1. Scope Gmail minimal, additif, jamais couplé à Calendar dans ce code

`gmail.send` uniquement — strictement le nécessaire pour `users.messages.send` (ni lecture, ni
recherche, ni labels, ni pièces jointes reçues). Classé "Sensitive" par Google (pas "Restricted")
au moment de l'écriture : une vérification de l'application par Google peut néanmoins être
nécessaire avant un usage public en production, indépendamment de ce code.

`/api/auth/google/gmail/login` (nouvelle route) demande **`gmail.send` seul**, jamais
`[calendar, gmail.send]` construit en dur — `include_granted_scopes=true` (déjà actif) laisse
Google plier le scope Calendar déjà accordé dans le nouveau refresh token, sans que ce code
suppose ou impose cette union. `/api/auth/google/login` (Calendar) **reste inchangée**. Le callback
reste générique : il stocke exactement le `scope` retourné par Google, jamais une supposition
liée à la route appelée (`chargerCapacitesGoogle()` ne dérive jamais `gmailAutorise=true` du seul
fait que la route Gmail a été visitée).

`prompt=consent` toujours forcé pour la route Gmail (jamais conditionnel comme pour Calendar) : un
refresh_token est requis à coup sûr pour cette nouvelle capacité.

**Défense existante confirmée, pas ajoutée** : `echangerCodeContreTokens` lève déjà si Google ne
retourne pas de `refresh_token` (`TokensGoogle.refreshToken` typé `string`, jamais optionnel) — un
refresh token valide déjà stocké ne peut donc jamais être écrasé par `undefined`.

### 2. Capacités Calendar/Gmail distinctes, jamais un statut unique

`chargerCapacitesGoogle()` (`src/lib/google/capacites.ts`) découpe le `scope` stocké (désormais
exposé par `ConnexionGoogle`) en `Set<string>`, jamais un `.includes()` sur la chaîne brute. UI :
deux lignes indépendantes sur la page d'accueil — `Google Calendar : connecté` /
`Gmail : non autorisé [Autoriser Gmail]`. Statut **optimiste** (reflète le dernier consentement
accordé, pas un contrôle live) — documenté comme tel, jamais présenté comme une garantie.

Le bouton "Déconnecter" existant reflète honnêtement la révocation globale une fois Gmail accordé
(`"Déconnecter Google (Calendar + Gmail)"`) — jamais un libellé laissant croire à une déconnexion
partielle impossible avec le modèle OAuth de Google.

### 3. Aucun changement au moteur ADR-031

`resoudreContexteCommunicationDepuisTache`, `resoudreDestinatairesDepuisDocument`,
`genererBrouillonEmail`, `FaitsCommunication` : **non modifiés**. `envoyerEmailGmailAction` reçoit
uniquement `{destinataireEmail, objet, corps}` — la version actuellement éditée dans
`BrouillonEmailFormulaire` — jamais recalculée, jamais réinterprétée, aucun LLM, ne décide jamais
du destinataire ni du moment de l'envoi.

### 4. Confirmation humaine explicite, jamais un envoi implicite

Écran de confirmation dédié (`EcranConfirmationEnvoi`, dans `BrouillonEmailFormulaire.tsx`) —
figé (À/Objet/Corps en lecture seule), atteint uniquement par un clic explicite sur "Envoyer avec
Gmail", jamais à la génération du brouillon, au chargement de page, à une création de tâche, à un
constat documentaire ou à une navigation.

### 5. Idempotence par clé cliente, jamais une fenêtre de temps

`envois_email` (nouvelle table) — `id` **fourni par l'appelant** (`crypto.randomUUID()`, généré
côté client à l'entrée de l'écran de confirmation), utilisé comme clé d'idempotence :
`INSERT ... ON CONFLICT (id) DO NOTHING` avant tout appel Gmail. Une resoumission de la même clé
(double clic, retry réseau) ne déclenche jamais un second appel — l'action relit l'état existant.

**Empreinte technique, jamais une garde bloquante** : `contenuHash` (SHA-256 de
destinataire+objet+corps) est stockée pour diagnostic uniquement — la garde temporelle
initialement envisagée (fenêtre de quelques minutes sur destinataire+objet) a été retirée car
arbitraire et susceptible de bloquer deux emails légitimes de même objet.

**Reconstruction fiable de la clé côté UI** : `EcranConfirmationEnvoi` est monté avec
`key={idempotencyKey}` par le parent — regénérer la clé après un résultat terminal (incertain/
échec) **remonte** ce sous-arbre, donnant un `useActionState` propre plutôt que de risquer une
resoumission avec une clé DOM pas encore synchronisée avec l'état React.

### 6. `incertain` distinct d'`echec`

Trois timestamps terminaux mutuellement exclusifs par construction applicative (gel concurrent
`WHERE ... IS NULL`, même patron que `taches`) : `reussiLe` → `envoye`, `echoueLe` → `echec`,
`incertainLe` → `incertain`, aucun des trois → `en_cours`. `incertain` est posé quand une rupture
réseau/timeout survient **après** le déclenchement de `messages.send` (`gmailClient.ts` distingue
explicitement une réponse HTTP effectivement reçue et non-2xx — `echec`, résultat connu — d'une
absence de réponse exploitable — réseau rompu, timeout, corps illisible, ou 2xx sans identifiant
valide — `incertain`, résultat inconnu). Pour `incertain` : aucun renvoi automatique, aucune
interaction ADR-027, aucun `dernierContactLe`, aucun message de succès — message explicite
demandant de vérifier les messages envoyés Gmail avant toute nouvelle tentative, qui doit être un
geste humain explicite utilisant une nouvelle clé.

### 7. Terminologie stricte

Succès affiché : **"Envoi confirmé par Gmail"** — jamais "reçu", "délivré au destinataire" ou
"preuve de livraison" : `users.messages.send` ne renseigne que la réception par l'API Gmail, pas
la livraison effective.

### 8. Construction MIME sécurisée

`src/lib/google/mimeEmail.ts` : validation stricte de l'adresse email, **rejet** (pas un simple
retrait silencieux) de `\r`/`\n` dans tous les en-têtes (`To`, `Subject`) — protection contre
l'injection d'en-têtes puisque objet/corps sont édités par le conseiller juste avant confirmation.
Le corps (texte libre) autorise les retours à la ligne, n'étant pas un en-tête. Objet toujours
encodé RFC 2047 (UTF-8/Base64), message final encodé **base64url** (RFC 4648 §5 — jamais du
base64 standard, rejeté par le champ `raw` de l'API Gmail). Aucun en-tête supplémentaire construit
depuis une entrée non validée.

### 9. Traçabilité technique ≠ CRM, corps jamais persisté

`envois_email` : audit technique uniquement (destinataire, objet, `contenuHash`, dates
démarrage/succès/échec/incertain, `gmailMessageId`, catégorie d'erreur courte). **Le corps complet
n'y est jamais stocké.** Le fait CRM reste exclusivement `notesProspectVendeur` (type `'email'`,
déjà existant ADR-027), posé **uniquement** après `marquerEnvoiReussi` réel, contenu court (objet
seul, jamais une copie intégrale du corps) — `dernierContactLe` avance automatiquement (mécanisme
déjà en place, inchangé). Pour `acquereurs` et tout domaine sans journal structuré : rien n'est
écrit nulle part, limite documentée, jamais comblée en écrivant dans `taches`.

### 10. Tâche ADR-028 : proposition, jamais une déduction automatique

Après succès confirmé, si l'envoi provient d'une tâche : *"Email envoyé. [Marquer également la
tâche comme terminée]"* — réutilise `terminerTacheAction` sans modification. Aucune clôture
automatique : une tâche peut légitimement rester ouverte après un email envoyé.

### 11. Fallback préservé

`BrouillonEmailFormulaire` conserve "Ouvrir dans le client mail"/"Copier le message" dans tous les
états (édition et confirmation) — une panne Gmail ou une autorisation absente n'empêche jamais le
conseiller de travailler. Aucun bouton n'est jamais appelé "Envoyer" seul, sans confirmation.

### 12. Contact notaire — toujours hors périmètre

`message_notaire` reste en contenu seul, `biens.notaireEmail` n'est pas ajouté — aucune saisie
libre ponctuelle de secours proposée non plus (serait une donnée inventée sans rattachement
structurel vérifiable, exactement ce que le modèle interdit).

## Alternatives écartées

- **Union de scopes `[calendar, gmail.send]` codée en dur pour la route Gmail** : écartée au
  profit de l'autorisation incrémentale native de Google (`gmail.send` seul +
  `include_granted_scopes`), qui évite de coupler Gmail à Calendar dans ce code.
- **Fenêtre de temps arbitraire (destinataire+objet, quelques minutes) comme garde secondaire** :
  retirée explicitement — risque de bloquer deux emails légitimes de même objet à des
  destinataires différents ou à des moments différents ; remplacée par `contenuHash`, purement
  diagnostique.
- **`incertain` fondu dans `echec`** : rejeté — assimilerait une ambiguïté réseau à un résultat
  connu, inviterait à tort un renvoi automatique.
- **`biens.notaireEmail` ou saisie libre ponctuelle pour le notaire** : rejeté à nouveau,
  cohérent avec ADR-031.

## Conséquences

- Migration `0019_new_hemingway.sql` : table `envois_email`.
- Fichiers modifiés : `src/lib/google/{oauth,connexion}.ts` (scopes paramétrés, `scope` exposé),
  `src/app/api/auth/google/login/route.ts`, `src/app/page.tsx` (statuts distincts).
- Nouveaux fichiers : `src/app/api/auth/google/gmail/login/route.ts`,
  `src/lib/google/{capacites,mimeEmail,gmailClient}.ts`, `src/types/envoiEmail.ts`,
  `src/lib/envoiEmailRepository.ts`, `src/actions/envoyerEmailGmail.ts`.
- `src/components/communications/BrouillonEmailFormulaire.tsx` étendu (écran de confirmation,
  fallback préservé), `src/app/communications/nouveau/page.tsx` câblé (capacités, destinataire
  résolu, tâche/bien de contexte).
- Tests : `mimeEmail.test.ts` (7 cas, injection d'en-têtes), `gmailClient.test.ts` (7 cas,
  succès/échec/incertain via fetch mocké), `envoiEmailRepository.test.ts` (6 cas, idempotence et
  gel concurrent), `envoyerEmailGmail.test.ts` (5 cas d'intégration Postgres, dont un double
  submit concurrent vérifiant un seul appel Gmail réel) — suite complète du projet passante
  (634 tests).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- **Hors périmètre, confirmé** : lecture Gmail, synchronisation boîte de réception, réponses,
  pièces jointes, auto-send, règles automatiques de relance, campagnes, LLM, SMS, contact notaire
  structuré, réseaux sociaux, authentification Atlas multi-utilisateur.
