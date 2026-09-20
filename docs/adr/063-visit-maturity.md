# ADR-063 — Maturité de la Visite : modèle canonique V1, identité Calendar facultative, bon de visite signé

**Statut :** Accepté — **PARTIALLY IMPLEMENTED** (`VISIT_NATIVE_LIFECYCLE_V1` livré le 2026-09-19 ; migration 0050). Lifecycle natif (création sans Calendar, workspace scoping des 10 fonctions, garde archivage, `UNIQUE` compte-rendu, `realisee_le`/`annulee_le`, `visite_annulee`) implémenté et testé. `VISIT_SIGNED_FORM_V1` (bon de visite signé) reste **non implémenté** — voir roadmap ci-dessous.

**Date :** 2026-09-19
**Décideurs :** Steven Gausset (CEO), CTO — besoin bon de visite remonté par Bérengère (terrain).

> Dépend de : **ADR-040** (entité `visites` minimale, statuts, matérialisation idempotente, report/annulation),
> **ADR-041** (fiche Visite Atlas autonome, `suivi_apres_visite` par intérêt, séparation GET/écriture),
> **ADR-032/033** (moteur événementiel/temporel), **ADR-054** (appartenance workspace),
> **ADR-056** (`references_externes`, identités externes — et son §10 qui gèle déjà `rendez_vous_calendar_id`
> hors de cette couche), **ADR-060/061/062** (patron de maturité déjà appliqué à Mandat/Offre/Automation :
> entité canonique, legacy facultatif jamais bloquant, writers atomiques scoped, obsolescence, snapshot).

## Contexte

Le domaine Visite est **PARTIAL**. ADR-040/041 ont déjà posé une fondation réelle et testée — table `visites`
distincte, trois statuts (`planifiee`/`realisee`/`annulee`), matérialisation idempotente au niveau DB, fiche
`/visites/{id}` qui lit exclusivement Postgres (aucun appel Calendar dans son noyau), report/annulation
atomiques, `suivi_apres_visite` déjà sensible à `interet`. Ce n'est donc pas un domaine à construire depuis
zéro — c'est un domaine dont la fondation existe mais dont la **création** reste structurellement dépendante
de Google Calendar (`rendez_vous_calendar_id` `NOT NULL UNIQUE`), dont **aucune lecture ni écriture n'est
scoped par workspace**, et où un **nouveau besoin produit explicite** — le bon de visite signé — n'a encore
aucune place dans le modèle de données.

Cet ADR ne construit rien. Il tranche les questions de modèle pour que `VISIT_NATIVE_LIFECYCLE_V1` et
`VISIT_SIGNED_FORM_V1` puissent être implémentés sans redécouvrir ces questions en cours de route — même
discipline que ADR-060/061 avant leurs lots respectifs.

## DECISIONS

| Clé | Décision |
|---|---|
| `VISIT_NATIVE_ENTITY` | OUI, déjà vrai pour la LECTURE (ADR-041 : la fiche `/visites/{id}` ne dépend de Calendar en rien), reste FAUX pour la CRÉATION (`materialiserVisite` exige `rendezVousCalendarId` non-null aujourd'hui). Cible : Visite = entité canonique de bout en bout ; Calendar = représentation/synchronisation externe **facultative**, jamais l'identité métier primaire. |
| `CALENDAR_ID_FUTURE_NULLABLE` | OUI. `visites.rendez_vous_calendar_id` devient nullable ; l'unicité devient un index unique **partiel** (`WHERE rendez_vous_calendar_id IS NOT NULL`) — même idiome déjà utilisé par `evenements_metier` (ADR-032/033/061/062). Un même événement Calendar continue de ne jamais matérialiser deux visites ; une Visite native sans Calendar reste simplement non contrainte par cet index. |
| `EXTERNAL_IDENTITY_MODEL` | `rendez_vous_calendar_id` **reste une colonne propre à `visites`**, PAS migrée vers `references_externes` en V1. `references_externes` (ADR-056) porte aujourd'hui exactement 6 bras de cible (contact/projetAcquereur/projetVendeur/bien/mandat/interaction), CHECK à exactement un ; y ajouter un 7ᵉ bras `visiteId` serait un vrai changement de schéma, pas gratuit. `docs/KNOWN_LIMITATIONS.md` documente déjà `rendez_vous_calendar_id` comme dette **volontairement gelée hors de cette couche** (ADR-056 §10, aux côtés de `envois_email.gmail_message_id`) — cet ADR **confirme** ce gel, ne le lève pas. Réévaluer seulement si un connecteur externe générique multi-fournisseurs est un jour construit (`CALENDAR_CONNECTOR_HARDENING_V1`). |
| `VISIT_SOURCE_OF_TRUTH` | table `visites` |
| `ACCOUNT_REPORT_SOURCE_OF_TRUTH` | table `comptes_rendus_visite` |
| `SIGNED_VISIT_FORM_SOURCE_OF_TRUTH` | futures tables `bons_visite` + `signatures_bon_visite` (+ la ligne `documents_bien` du fichier final immuable) — non implémentées |
| `CALENDAR_SOURCE_OF_TRUTH` | représentation de planification externe uniquement, jamais une source de vérité métier — déjà vrai pour la fiche (ADR-041), cible confirmée pour le reste du domaine une fois la création native livrée |
| `VISIT_ROUTES_CANONICAL_ID` | `visite.id` partout où DOMIORA écrit du code neuf. La coexistence actuelle de deux sémantiques sous `/visites/` (`/visites/{id}` = `visite.id`, ADR-041 ; `/visites/{id}/preparer` = `rendezVousCalendarId`, ADR-040/041) est **intentionnelle et correcte aujourd'hui**, pas un défaut : `/preparer` a structurellement besoin de l'id Calendar tant que la création reste Calendar-dépendante. Le commit `40e8f2c` a **corrigé un lien prématurément basculé vers `visite.id`** (404 garanti tant que `/preparer` exige l'id Calendar) — il n'a pas engagé de trajectoire vers le modèle cible, il a empêché une régression du modèle actuel. Unifier `/preparer` sur `visite.id` n'a de sens qu'une fois la création Calendar-optionnelle livrée (`VISIT_NATIVE_LIFECYCLE_V1`) ; avant cela, forcer `visite.id` reproduirait exactement le bug que `40e8f2c` a corrigé. |
| `VISIT_STATUSES_V1` | **inchangés** : `planifiee` / `realisee` / `annulee` (CHECK déjà exactement ce vocabulaire, ADR-040). Aucun `en_cours`, aucun `a_confirmer` — mêmes raisons qu'ADR-040 (visite de 20-40 min, aucun état temps réel observé ; un état de confirmation ajouterait une distinction sans writer ni lecteur démontré). |
| `VISIT_TRANSITIONS` | `planifiee → realisee` (uniquement via création d'un compte rendu, inchangé ADR-040/041, jamais un bouton indépendant) ; `planifiee → annulee` ; `planifiee → planifiee` (report, même ligne, `date_prevue` modifiée). `realisee → annulee` **interdit** (déjà garanti par l'`UPDATE … WHERE statut = 'planifiee'` conditionnel, testé). Une visite passée restée `planifiee` (`date_prevue < aujourd'hui`) reste **volontairement** `planifiee` — ADR-040 l'a déjà tranché explicitement ("Atlas ne connaît pas l'issue") : c'est la matière première exacte de la future règle `visite_sans_compte_rendu`, jamais une transition automatique. |
| `VISIT_DATES_V1` | conservées : `datePrevue` (date civile, jamais une heure — inchangé ADR-040/041), `creeLe`. **Ajoutées** (futur `VISIT_NATIVE_LIFECYCLE_V1`) : `realiseeLe`, `annuleeLe` (timestamptz nullables) — aujourd'hui **aucune** des deux transitions ne date son propre franchissement, seul `creeLe` existe. Pas de `finPrevue`/`modifieLe` : aucun besoin démontré, cohérent avec ADR-040/041 (l'heure/durée restent la responsabilité de Calendar tant qu'Atlas ne possède pas la planification elle-même). Calendar ne doit jamais rester la seule source d'une date persistée — déjà vrai pour `datePrevue` (ADR-041 §4), cible confirmée pour `realiseeLe`/`annuleeLe`. |
| `VISIT_BIEN_CARDINALITY` | exactement un Bien (`bien_id NOT NULL`, inchangé). Bien archivé : **aucune garde aujourd'hui** (gap réel, confirmé par audit — création possible sur un Bien archivé sans blocage). Cible : création interdite sur Bien (et Acquéreur) archivé, historique conservé — même patron qu'Offre/Mandat. |
| `BUYER_MODEL_V1` | `acquereur_id` legacy scalaire, inchangé — même modèle qu'Offre/Mandat/Compromis. |
| `BUYER_LEGACY_BLOCKER` | NO — même verdict qu'Offre (ADR-061) : la liaison legacy ne bloque ni le lifecycle, ni le workspace, ni les événements, ni les documents. **Distinction nouvelle et nécessaire** introduite par le bon de visite : `acquereur_id` de la Visite répond à « pour quel projet commercial cette visite existe-t-elle » (pipeline/matching) — le(s) **signataire(s)** du bon répondent à « qui était physiquement présent et a signé », une question distincte qui peut inclure un conjoint, un associé, ou une personne pas encore Contact du tout (§ signataire ci-dessous). Ces deux notions ne doivent jamais être fusionnées dans une seule colonne. |
| `VISIT_PARTICIPANTS_MODEL` | **pas** de table `participants_visite` séparée en V1 — qui a assisté à la visite reste informel (note libre existante, `notes_bien`, suffit) ; aucun besoin démontré de normaliser "qui était présent" indépendamment de "qui a signé". Le bon de visite capture les signataires directement (voir `VISIT_SINGLE_OR_MULTI_SIGNER_V1`), sans dupliquer une notion de participants générique. |
| `VISIT_SINGLE_OR_MULTI_SIGNER_V1` | **schéma multi-signataire dès V1**, parcours produit V1 concentré sur un signataire principal. `signatures_bon_visite` est une table ENFANT (une ligne par signature) — un second signataire (conjoint, associé) est déjà une simple ligne supplémentaire à ajouter en V2, **jamais une migration**. Un couple visitant ensemble est un cas courant, pas un cas limite : contraindre le SCHÉMA à un seul signataire aurait immédiatement paru cassé pour le cas le plus fréquent, même si l'UX V1 ne propose qu'un flux de signature à la fois. |
| `SIGNED_VISIT_FORM_MODEL` | **Option C** du brief : ni un booléen sur `visites`, ni une entité monolithique `bons_visite` qui confondrait le formulaire et l'acte de signature. Deux tables : `bons_visite` (le document/instance de formulaire : `visiteId`, template/version, contenu figé, `documentId` nullable vers le fichier final immuable, `statut` brouillon/signé, `workspaceId`, `creeLe`) et `signatures_bon_visite` (l'acte de signature, potentiellement plusieurs lignes : `bonVisiteId`, signataire snapshot, `provider`, `externalSignatureId` nullable, `signeLe`, hash nullable). |
| `SIGNED_FORM_SIGNER_SNAPSHOT` | `contact_id` **nullable** + snapshot figé (`nom`, `prenom`, `email` nullable) capturé **au moment de la signature**. Un signataire peut ne pas encore être un Contact canonique. Le snapshot signé reste historique même si le Contact change, fusionne ou disparaît ensuite — même principe que les snapshots déjà établis pour la fusion Contact (ADR-059). |
| `SIGNED_FORM_PROVIDER_MODEL` | champs conceptuels `provider` (texte, ex. `"domiora"` pour la capture tactile/checkbox native V1) + `external_signature_id` (texte nullable, pour un futur prestataire e-signature). Jamais d'architecture verrouillée sur un seul fournisseur — le choix du NIVEAU de signature (A. manuscrite tactile / B. checkbox / C. OTP / D. prestataire externe) est une décision produit du lot d'implémentation, pas de cet ADR ; le contrat de données doit simplement pouvoir accueillir n'importe laquelle sans redesign. |
| `SIGNED_FORM_HASH` | recommandé (non codé) : `hash_document` (sha256) nullable sur `signatures_bon_visite`, pour lier la preuve à l'exact document signé, octet pour octet. |
| `SIGNED_FORM_IMMUTABILITY` | après signature, le contenu signé n'est **jamais** modifié en place. Toute correction = nouveau `bons_visite` (nouvelle ligne, nouveau document), jamais un `UPDATE` du contenu figé. Une fois `statut = 'signe'`, la ligne devient terminale — même discipline que `visites.realisee`/`offres.acceptee` (ADR-040/061) : `UPDATE … WHERE statut = 'brouillon'`, jamais un écrasement silencieux. |
| `SIGNED_FORM_LEGAL_SCOPE` | documenté strictement comme des **capacités produit**, jamais une valeur juridique affirmée : identité déclarée (snapshot, non vérifiée), horodatage serveur, consentement explicite (geste de signature délibéré), preuve liée au document exact (hash + immutabilité), conservation du document signé, traçabilité de l'action. Toute qualification "signature électronique qualifiée/avancée" (sens eIDAS ou équivalent) reste **hors périmètre** tant qu'un prestataire et ses garanties contractuelles ne sont pas choisis. |
| `DOCUMENT_VISIT_TARGET_REQUIRED` | OUI, futur — `documents_bien` n'a aujourd'hui **aucune** colonne `visite_id` (confirmé par audit). Modèle actuel de cette table : **cumulatif**, pas exclusif (`bien_id NOT NULL` + `compromis_id`/`acquereur_id`/`prospect_vendeur_id` indépendamment nullables, `SET NULL`, cumulables — contrairement au modèle "au plus une cible" de `taches`). Le futur `visite_id` nullable suit exactement ce même patron cumulatif, `SET NULL` — cohérent avec le rationale déjà documenté pour `compromis_id` (le document reste plus fondamental que le lien). |
| `GDPR_SCOPE` | données personnelles nouvelles : contenu de signature (image dessinée intégrée au document — jamais extraite ni utilisée pour une reconnaissance biométrique), identité snapshot du signataire (nom/prénom/email). **Aucune IP, aucun fingerprint device stocké en V1** — non démontré nécessaire, principe de minimisation ; réévaluable seulement si un prestataire/une exigence légale future l'impose explicitement. Aucune biométrie : une signature dessinée est une donnée du document, point final. |
| `ACCOUNT_REPORT_CARDINALITY` | cible **0..1** compte rendu canonique par visite — déjà l'invariant voulu, mais **actuellement garanti seulement par l'unique chemin d'écriture applicatif** : `comptes_rendus_visite.visite_id` est nullable et n'a **aucune contrainte `UNIQUE`** en base. Cible : `UNIQUE(visite_id) WHERE visite_id IS NOT NULL`, en défense en profondeur — même discipline que `compromis_bien_id_en_cours_unique` (ADR-047). Si plusieurs "versions" de compte rendu sont un jour nécessaires : préférer un modèle audit/versionné plutôt que plusieurs comptes rendus actifs simultanés (ADR-011, append-only). |
| `ACCOUNT_REPORT_STRUCTURED_FIELDS` | les champs actuels (`retour` libre, `interet` à 4 valeurs, `prochaineEtape` libre) restent **suffisants pour V1**. Budget/perception prix, niveau de projection, points positifs/négatifs structurés : **pas construits maintenant**, aucun consommateur downstream démontré aujourd'hui (ADR-008 : données structurées seulement quand un besoin réel existe, jamais par anticipation). Reclassés P3, à réévaluer si le matching ou une automatisation concrète en a explicitement besoin. |
| `SELLER_FEEDBACK_MODEL` | aujourd'hui, "retour vendeur effectué" = **une Tâche cochée**, rien d'autre — aucune Interaction créée, aucune donnée structurée sur le CR. `interactions` existe déjà, porte déjà le type `'rendez_vous'`, et un commentaire de code anticipe explicitement *"une visite POURRA produire une interaction ; elle n'en devient pas une par changement de nom"* — cible confirmée : le retour vendeur (et la création de CR) devraient à terme écrire une Interaction, pour ne pas laisser une simple case cochée être l'unique source de vérité métier alors qu'un journal générique existe. Non implémenté ici — P3, candidat pour `VISIT_AUTOMATION_V1` ou un lot dédié. |
| `VISIT_EVENTS_V1` | actuel : `visite_realisee` uniquement, ciblant `compteRenduVisiteId` (jamais `visiteId` directement) — définition retenue par ADR-041 §5 : *"un compte rendu vient d'être créé"*, la transition de statut en est une conséquence, pas une garantie DB indépendante. **Ajouts retenus, valeur downstream démontrée** : `visite_annulee` (alimente une future automatisation/nettoyage, symétrique de `visite_realisee`) — à ajouter avec `VISIT_NATIVE_LIFECYCLE_V1`. `bon_visite_signe` — à ajouter avec `VISIT_SIGNED_FORM_V1` (déclencheur naturel pour générer/notifier/figer). **Rejetés explicitement** : `compte_rendu_visite_complete` (strictement redondant avec `visite_realisee`, qui porte déjà exactement ce sens) ; `visite_planifiee` (aucune règle temporelle n'en a besoin — le patron `mandat_expire_bientot`/ADR-062 scanne directement la table, pas un événement de création ; réévaluer seulement si un besoin événementiel distinct apparaît) ; `retour_vendeur_effectue` (aujourd'hui redondant avec l'achèvement de la Tâche existante — n'a de sens qu'une fois `SELLER_FEEDBACK_MODEL` migré vers une vraie Interaction). |
| `VISIT_AUTOMATION_CANDIDATES` | `visite_j_1` — scanner temporel sur `datePrevue`, même patron que `mandat_expire_bientot` (ADR-062), aucun événement requis. Précondition : lectures workspace-scoped (`VISIT_NATIVE_LIFECYCLE_V1`). `visite_sans_compte_rendu` — scanner sur `statut = 'planifiee' AND date_prevue < aujourd'hui - seuil`, surface exactement l'état qu'ADR-040 a délibérément choisi de ne jamais auto-transitionner. Même précondition. `compte_rendu_sans_retour_vendeur` — **probablement redondant** avec le mécanisme événementiel déjà existant : la tâche produite par `retour_vendeur_apres_visite` EST déjà ce signal (tâche ouverte = retour non fait) ; une règle temporelle séparée redétecterait la même chose sans valeur ajoutée démontrée, sauf si `SELLER_FEEDBACK_MODEL` évolue vers une Interaction et que le signal de "tâche ouverte" disparaît. Aucune de ces règles n'est implémentée ici. |
| `TODAY_VISIT_INTEGRATION` | aujourd'hui, Today (`getAgendaSemaine`) est **100 % sourcé Google Calendar**, zéro lecture de la table `visites` — écart confirmé, distinct du gap workspace. Cible future (pas une refonte) : une fois `VISIT_NATIVE_LIFECYCLE_V1`/`VISIT_AUTOMATION_V1` livrés, Today pourra afficher visite aujourd'hui/demain, visite passée sans CR, CR sans retour vendeur, bon non signé si attendu — capacités, pas un chantier de cet ADR. |
| `OFFER_VISIT_LINK` | une Offre ne DOIT jamais référencer une Visite obligatoirement. Le lien existant (`offre_visites`, `offreId` ↔ `compteRenduVisiteId`, jamais `visiteId`) reste optionnel, source d'information seulement — aucune contrainte artificielle introduite. |
| `MATCHING_VISIT_INPUTS` | données Visite pouvant nourrir plus tard le matching, sans modification de l'algorithme dans ce lot : visite réalisée (déjà partiellement exploité via `existeVisitePlanifieePourPaire` pour la garde anti-doublon de `nouveau_match_bien_acquereur`), intérêt (déjà capturé), offre produite (déjà liable via `offre_visites`). Rejet après visite avec raison structurée : non capturé aujourd'hui, dépend de `ACCOUNT_REPORT_STRUCTURED_FIELDS` (P3). |
| `WORKSPACE_MODEL` | gap réel et total, confirmé par audit : **aucune** des 10 fonctions exportées de `visiteRepository.ts` ni de `compteRenduVisiteRepository.ts` ne prend de `workspaceId` ni ne scope par `biens.workspace_id` — contrairement à Offre/Mandat (ADR-054 §7). Cible : `Visite → Bien → workspace`, acquéreur du même workspace vérifié à la création (même patron que `acquereurDuWorkspace`, ADR-061 §14). Cross-workspace = introuvable. Jamais un `workspaceId` issu du FormData. |
| `ARCHIVE_POLICY` | historique conservé indéfiniment (fusion Contact, changement de mandat, vente, archivage Bien, suppression de l'événement Calendar d'origine — jamais de cascade destructive depuis Calendar, qui n'a de toute façon aucun chemin d'écriture vers Atlas aujourd'hui). Création : interdite sur Bien/Acquéreur archivé (gap actuel confirmé, aucune garde n'existe — à corriger dans `VISIT_NATIVE_LIFECYCLE_V1`). |
| `DELETE_POLICY` | pas de `DELETE` physique en production métier pour une Visite canonique — annulation/statut terminal seulement. Les fixtures de test peuvent supprimer (convention déjà établie partout ailleurs dans ce dépôt). |
| `CONCURRENCY_MODEL` | réaliser vs annuler, réaliser deux fois : déjà sûrs (`UPDATE … WHERE statut = 'planifiee'`, testé). Création double compte rendu : **non gardée en base aujourd'hui** (voir `ACCOUNT_REPORT_CARDINALITY`) — à durcir. Signature bon de visite double soumission : exigence pour `VISIT_SIGNED_FORM_V1`, même famille de patron que le verrou Bien déjà établi pour Offre/Compromis (ADR-061) — probablement un verrou de la Visite avant toute création/signature de bon. |
| `LEGACY_CALENDAR_COEXISTENCE` | `/visites/{id}/preparer` continue de fonctionner exactement comme aujourd'hui jusqu'à la livraison de `VISIT_NATIVE_LIFECYCLE_V1` — aucune route existante cassée par cet ADR (qui ne change aucun code). |

## Bon de visite — objet métier (détail du modèle)

Le bon de visite n'est **pas** un champ booléen sur `visites`. C'est un document généré, présenté, signé, et
figé — dont l'acte de signature (potentiellement par plusieurs personnes) est distinct du document lui-même.
Modèle recommandé (deux tables, non implémentées) :

```
bons_visite
  id, visite_id (FK), workspace_id, template_version (texte/id), contenu_fige (snapshot),
  document_id (FK documents_bien, nullable jusqu'au gel), statut ('brouillon' | 'signe'), cree_le

signatures_bon_visite
  id, bon_visite_id (FK), contact_id (nullable), nom_snapshot, prenom_snapshot, email_snapshot (nullable),
  provider (texte), external_signature_id (texte, nullable), hash_document (nullable), signe_le
```

**Contenu du bon** (à évaluer au lot d'implémentation, aucune mention juridique définitive ici) : identité
conseiller, agence/réseau, identité et coordonnées du/des signataire(s), bien visité (adresse, référence),
date/heure de visite, texte/mentions selon template versionné, signature(s), horodatage.

**Configuration réseau** : le texte du bon dépend potentiellement du réseau/de l'agence/du pays/d'une
politique interne — jamais un texte codé en dur dans Core (pas de mentions IAD hardcodées). V1 peut livrer
un seul template DOMIORA par défaut, mais le modèle (`template_version`) doit rester *network-agnostic* dès
le départ : changer le texte doit être un changement de donnée, jamais un changement de code.

**Workflow cible** (produit, futur lot) : visite planifiée → préparer → ouvrir le bon → informations
préremplies → présenter au visiteur → signature(s) → génération/gel du document signé → stockage → visite
réalisée (inchangé : toujours via création du compte rendu) → compte rendu. **Signature non obligatoire
avant `realisee`** — une visite sans bon signé reste un cas normal (refus, import historique, période avant
adoption de la fonctionnalité), jamais un blocage du lifecycle existant.

## Hors périmètre, volontairement

Choix du prestataire de signature (A/B/C/D — décision du lot d'implémentation), rédaction des mentions
juridiques définitives du bon, affirmation de valeur eIDAS qualifiée/avancée, synchronisation Calendar
bidirectionnelle, import automatique de tout le calendrier, refonte de Today, IA de compte rendu, scoring
acquéreur, `participants_visite` générique, migration de `taches.visite_id` vers `visites.id` (dette déjà
documentée par ADR-041 §8, non reprise ici), extraction complète du connecteur Google Calendar
(`CALENDAR_CONNECTOR_HARDENING_V1`), toute migration ou tout code.

## Priorités

**P0** — aucun trouvé (rien d'actuellement cassé ou exploitable).
**P1** — aucun trouvé (aucun flux actuel rendu inutilisable).

**P2** :
- ~~absence totale de scoping workspace sur `visiteRepository.ts`/`compteRenduVisiteRepository.ts`~~ — **fermé** par `VISIT_NATIVE_LIFECYCLE_V1` (2026-09-19) : les 8 fonctions destinées à être scopées le sont (`listerVisites`/`listerComptesRendus` restent volontairement non scopées, exception documentée en tête de fichier, même patron que les lecteurs globaux Today/opportunités)
- ~~`rendez_vous_calendar_id` `NOT NULL` bloquant toute création native~~ — **fermé**, colonne nullable + index unique partiel (migration 0050)
- ~~absence de `realisee_le`/`annulee_le`~~ — **fermé**, posées exactement une fois par `annulerVisite`/`creerCompteRenduEtRealiserVisite`
- ~~absence de garde d'archivage Bien/Acquéreur à la création~~ — **fermé**, `creerVisiteEnBase` refuse la création (chemin natif et chemin Calendar)
- ~~absence de `UNIQUE(visite_id)` sur `comptes_rendus_visite`~~ — **fermé**, index unique partiel (migration 0050) en défense en profondeur du verrou applicatif
- **bon de visite signé** — toujours ouvert, besoin terrain explicite (Bérengère), lot séparé
  (`VISIT_SIGNED_FORM_V1`), maintenant que la fondation lifecycle native est livrée
- **`/visites/{id}/preparer` reste Calendar-id-based** — non migré vers `visite.id` en V1 (une Visite native
  n'a pas de préparation enrichie géo/transports/écoles/marché ; elle réalise/annule/reporte directement
  depuis `/visites/{id}`, formulaire de compte rendu inline). Limitation documentée, pas un défaut : migrer
  `/preparer` vers `visite.id` nécessiterait de décider d'abord ce que "préparer" signifie pour une visite
  sans Calendar — hors périmètre de ce lot (voir `docs/KNOWN_LIMITATIONS.md`).

**P3** : champs CR structurés enrichis (budget, projection, points +/-), migration retour-vendeur vers
Interaction, événements `visite_planifiee`/`retour_vendeur_effectue`, extraction complète du connecteur
Calendar / support multi-fournisseur, import Calendar automatique, Today enrichi, `participants_visite`
générique, hash du document signé (recommandé mais non bloquant), co-acquéreurs/BuyerProject.

## Tests attendus (futurs lots, non écrits ici)

`VISIT_NATIVE_LIFECYCLE_V1` : création sans `rendez_vous_calendar_id`, unicité partielle toujours respectée
avec Calendar, workspace isolation sur les 10 fonctions de lecture/écriture, garde archivage, `UNIQUE`
compte-rendu, `realisee_le`/`annulee_le` posés exactement une fois, non-régression complète des 14+ cas
`visiteRepository.test.ts` existants et de `visite.annulerReporter.test.ts`.

`VISIT_SIGNED_FORM_V1` : idempotence de signature (double soumission), immutabilité après signature (aucun
`UPDATE` du contenu figé possible), snapshot signataire conservé après fusion/modification du Contact,
événement `bon_visite_signe` exact-once, document final rattaché et retrouvable depuis la Visite.

## Roadmap Visite (lots futurs, non créés ici)

1. **`VISIT_NATIVE_LIFECYCLE_V1`** — **LIVRÉ (2026-09-19, migration 0050)** : migration
   (`rendez_vous_calendar_id` nullable + index partiel, `realisee_le`/`annulee_le`, `UNIQUE` compte-rendu),
   scoping workspace des fonctions destinées à l'être, garde archivage, création native, `visite_annulee`,
   coexistence Calendar préservée (`/preparer` inchangé, Calendar-id-based).
2. **`VISIT_SIGNED_FORM_V1`** — `bons_visite` + `signatures_bon_visite`, `documents_bien.visite_id`,
   `bon_visite_signe`, génération/capture/immutabilité. Séquencé APRÈS le lot 1 (bénéficie du scoping
   workspace ; ne dépend pas techniquement de la création Calendar-optionnelle, mais construire un nouveau
   sous-système sur une fondation encore non scopée serait imprudent).
3. **`VISIT_AUTOMATION_V1`** — `visite_j_1`, `visite_sans_compte_rendu`, migration retour-vendeur vers
   Interaction.
4. **`CALENDAR_CONNECTOR_HARDENING_V1`** — découplage complet de Google Calendar derrière un connecteur
   générique (retry, erreurs, éventuel multi-fournisseur), réévaluation de `EXTERNAL_IDENTITY_MODEL` à ce
   moment-là seulement.

## Conséquences

- Aucun fichier de production, aucune migration, aucun test modifié par cet ADR.
- `docs/DATA_MODEL.md` et `docs/KNOWN_LIMITATIONS.md` mis à jour pour documenter l'état actuel, la cible
  décidée, et référencer cet ADR — sans jamais prétendre que le modèle cible est implémenté.
- `NEXT_REQUIRED_OFFER_FOUNDATION_LOT`-style : le prochain lot de code pour ce domaine est
  `VISIT_NATIVE_LIFECYCLE_V1`, seulement quand décidé explicitement — cet ADR ne l'engage pas.
