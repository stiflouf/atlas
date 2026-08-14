# ADR-031 — Emails et relances assistées

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Audit du code réel des tâches (ADR-028), du CRM vendeur (ADR-027), des clients/acquéreurs, des
visites/offres/compromis, du dossier documentaire (ADR-029) et du pack notaire (ADR-030), ainsi que
des intégrations email existantes — aucune n'existe : la seule intégration Google du projet
(`src/lib/google/*`) est strictement Calendar, scope `calendar.events.readonly`, lecture seule.
Aucune dépendance LLM n'existe non plus (confirmé, ADR-008). ADR-004 (stratégie IA) prévoit
explicitement en phase 1 POC un "brouillon de relance" avec un principe Human-in-the-Loop non
négociable : *"Aucune action à conséquence externe (envoi de mail...) ne peut être exécutée sans
validation explicite du conseiller."* ADR-031 s'inscrit dans ce cadre déjà posé.

Un tour de plan a validé la direction avec quatre corrections intégrées ci-dessous avant codage.
Codage direct après incorporation.

## Décision

### 1. Cinq couches strictement séparées

INTENTION (pourquoi contacter) / DONNÉES FACTUELLES (ce qu'Atlas sait réellement, jamais inventé) /
BROUILLON (texte proposé) / VALIDATION HUMAINE (édition libre, aucune trace serveur) / ENVOI (geste
explicite hors périmètre du moteur — `mailto:`, voir point 6). Types dédiés
(`src/lib/communications/contexteCommunication.ts`) : `IntentionCommunication` (8 valeurs),
`TonMessage` (4 valeurs), `FaitsCommunication`, `DestinataireCandidat`, `BrouillonEmail`.

### 2. Résolution de destinataire depuis toutes les cibles métier pertinentes (correction n°1)

`resoudreContexteCommunicationDepuisTache(tache)` suit **uniquement** les FK/relations métier déjà
réelles de la tâche (`deriverCibleTache`, ADR-028) — jamais `titre`/`contexte` (texte libre) pour
deviner une personne :

```
tâche → prospectVendeur                              (direct)
tâche → acquereur                                      (direct)
tâche → visite → compteRenduVisite.acquereurId         → acquereur
tâche → offre → offre.acquereurId                      → acquereur
tâche → compromis → compromis.acquereurId              → acquereur
tâche → bien → prospectVendeurOrigine (ADR-027, ≤1)
             + acquéreur du compromis le plus pertinent → 0, 1 ou 2 candidats
tâche → rémunération → aucune relation câblée (pas de lookup par id de rémunération
                                                exposé par remunerationRepository — non ajouté,
                                                hors périmètre demandé)
```

**Jamais tranché arbitrairement** : 0 candidat ⇒ mode contenu seul ; 1 candidat ⇒ présélectionné ;
plusieurs candidats ⇒ un choix humain explicite est présenté (formulaire radio), jamais résolu côté
serveur. L'intention par défaut (`determinerIntentionParDefaut`) n'est déterminée **qu'après** le
choix du candidat pour une cible `bien` ambiguë — le type de destinataire retenu (vendeur ou
acquéreur) conditionne seul quel message a du sens.

### 3. Un constat documentaire ne choisit pas implicitement son destinataire (correction n°2)

`resoudreDestinatairesDepuisDocument(document, bienId)` ne présélectionne un destinataire **que**
si le document choisi porte lui-même un rattachement personne structuré et **non ambigu**
(`acquereurId` OU `prospectVendeurId`, jamais les deux à la fois — un document portant les deux
retombe sur le repli ci-dessous, jamais un choix arbitraire entre eux). Sinon, repli sur les mêmes
candidats structurels que le bien (`resoudreDestinatairesDepuisBien`, réutilisée). Aucune
correspondance `typeDocument → personne supposée` n'est codée — prépare proprement l'arrivée
future de contacts syndic/notaire sans figer de règle implicite aujourd'hui.

### 4. Deux couches de contenu, aucun LLM dans cette passe

Couche 1 (obligatoire, seule construite ici) : templates déterministes
(`genererBrouillonEmail.ts`), un rendu par `(intention, ton)`, chaque paragraphe conditionné
uniquement sur la présence d'un fait. Fonctionne sans dépendance, zéro appel réseau. Couche 2 (LLM
de reformulation) : **entièrement hors périmètre** (arbitrage explicite) — serait la première
intégration LLM réelle d'Atlas, un choix de fournisseur/gestion de clé/risque de coût non exercé
nulle part encore, à traiter dans une passe dédiée si retenue plus tard.

### 5. Quatre tons, contenu factuel jamais sensible

`professionnel` / `cordial` / `court` / `relance_douce` — varient la formulation du **même**
contenu factuel, jamais les faits. `documentLabel` ne porte jamais que le **nom** du type de pièce
(ex. "Pré-état daté") — jamais un extrait de son contenu (correction n°4 : *"Les templates ne
doivent jamais intégrer le contenu sensible d'un document"*). Un fait absent est omis, jamais
remplacé par un espace réservé.

### 6. `mailto:` avec repli copie systématique (correction n°3)

`construireLienMailto(destinataireEmail, objet, corps)` — `encodeURIComponent` (RFC 3986), jamais
`URLSearchParams` (encoderait les espaces en `+`, invalide pour un `mailto:`). Le lien est
**reconstruit à chaque rendu depuis l'état actuellement édité** par le conseiller (`objet`/`corps`
en state React), jamais depuis le brouillon initial. Deux boutons distincts, jamais un bouton
"Envoyer" : **Ouvrir dans le client mail** (masqué si le lien dépasse ~1800 caractères — limite
pratique des `mailto:` selon navigateurs/clients) et **Copier le message** (toujours disponible,
quelle que soit la longueur). Aucune pièce jointe possible — limitation structurelle du schéma
`mailto:`, pas une règle appliquée manuellement.

### 7. Notaire : contenu seul, aucun champ ajouté (arbitrage)

Aucune entité/champ contact notaire n'existe et **`biens.notaireEmail` n'est volontairement pas
ajouté** — une future modélisation notaire devra vivre au niveau transaction/parties et supporter
potentiellement plusieurs contacts, pas un champ scalaire unique sur `biens`. Le cas
`message_notaire` a donc toujours `candidats = []` : contenu seul, "Email impossible : adresse non
renseignée" affiché systématiquement, la copie reste le seul geste possible.

### 8. Sécurité reformulée (correction n°4)

Pas de nouvelle exposition à documenter comme un vague "aucune" — des faits précis : **aucun
fournisseur tiers serveur** (couche 1 uniquement, tout reste sur le serveur Atlas jusqu'au rendu
navigateur), **aucun brouillon persisté** (état React éphémère, rien en base), **aucun LLM**, et
**aucun document joint automatiquement** (garantie structurelle du `mailto:`, pas une validation
applicative à maintenir). L'absence générale d'authentification (ADR-006) reste une limite héritée
distincte, non aggravée ni résolue ici, déjà documentée pour ADR-030 — à traiter avant tout usage
exposé/multi-utilisateur.

### 9. Aucune interaction automatique, aucune tâche automatique

Avec `mailto:`, Atlas ne peut techniquement pas observer si l'email a réellement été envoyé (le
compose s'ouvre dans le client du conseiller, hors du contrôle du serveur). **Aucune interaction
n'est donc journalisée automatiquement** en V1 — le conseiller reste libre d'ajouter lui-même une
note via le mécanisme ADR-027 déjà existant (`notesProspectVendeur`, type `'email'` déjà prévu dans
le vocabulaire), indépendamment d'ADR-031. Pour `acquereurs`/`comptesRendusVisite`, aucun journal
d'interaction structuré n'existe — limite documentée, jamais comblée en écrivant dans `taches`.
Aucun brouillon ni constat ne génère de tâche `origine = 'automatique'`.

## Alternatives écartées

- **Deviner un destinataire depuis `titre`/`contexte` de la tâche** : rejeté d'emblée, contredit
  ADR-008 (aucune extraction de texte libre pour une règle métier).
- **Trancher automatiquement entre plusieurs candidats structurels** (ex. prioriser l'acquéreur sur
  le vendeur) : rejeté — un choix humain explicite prime toujours sur une heuristique de
  priorité inventée.
- **Correspondance `typeDocument → personne` codée en dur** pour les constats : rejetée, aurait
  anticipé une règle non demandée et bloqué l'évolution propre vers des contacts syndic/notaire.
- **`biens.notaireEmail`** : rejeté explicitement — un champ scalaire unique ne survivrait pas à
  une vraie modélisation transaction/parties multi-contacts future.
- **Couche LLM dans cette même passe** : rejetée, mélangerait un risque d'infrastructure/fournisseur
  tiers jamais exercé avec un moteur de contenu déterministe déjà auto-suffisant.
- **Confirmation d'envoi auto-déclarée** (case "j'ai envoyé" cochée par le conseiller) pour
  déclencher une interaction automatique : rejetée — une auto-déclaration n'est pas une confirmation
  vérifiée, la seule confirmation légitime viendrait d'un appel API serveur réel (hors périmètre).

## Conséquences

- **Aucune migration.**
- Nouveaux fichiers : `src/lib/communications/{contexteCommunication,destinataireCommunication,
  resoudreContexteCommunicationDepuisTache,genererBrouillonEmail,mailto}.ts`,
  `src/components/communications/BrouillonEmailFormulaire.tsx`,
  `src/app/communications/nouveau/page.tsx`.
- Points d'entrée ajoutés : `src/components/aujourd-hui/TacheItem.tsx` (lien "Préparer un email"),
  `src/components/bien/BienTabs.tsx` (onglets Tâches et Documents), `src/app/prospects-vendeurs/
  [id]/page.tsx`, `src/app/biens/[id]/pack-notaire/page.tsx` (message notaire).
- Tests : `genererBrouillonEmail.test.ts` (9 cas), `mailto.test.ts` (4 cas),
  `destinataireCommunication.test.ts` (6 cas d'intégration Postgres),
  `resoudreContexteCommunicationDepuisTache.test.ts` (14 cas d'intégration Postgres) — suite
  complète du projet passante (609 tests).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- **Hors périmètre, réservé à des passes ultérieures** : envoi Gmail réel (ADR-031-bis — nouveau
  scope OAuth, confirmation d'envoi vérifiable, idempotence serveur, journalisation automatique
  d'interaction devenant alors légitime), couche LLM de reformulation, SMS, pièces jointes,
  campagnes/newsletter/réseaux sociaux, règles automatiques de relance, création automatique de
  tâches, scoring commercial, contact notaire structuré, brouillons persistés.
