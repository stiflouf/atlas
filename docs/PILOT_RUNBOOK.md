# Runbook pilote — Atlas mono-conseiller

Point d'entrée opérationnel canonique du pilote mono-conseiller (audit V1 Candidate). Destiné à
l'exploitant (déploiement/exploitation), pas au conseiller utilisateur final (voir le guide
conseiller, à produire avant le pilote réel — hors périmètre de cette passe, voir
`docs/KNOWN_LIMITATIONS.md`).

Ce document ne duplique pas ce qui existe déjà ailleurs — il y renvoie :

- Checklist exacte des variables d'environnement/configuration : **`docs/adr/047-securisation-pilote-mono-conseiller.md#checklist-de-configuration-avant-pilote`**
  (emplacement canonique, ne pas la recopier ici).
- Procédure de migration production : **`docs/PROCEDURE_MIGRATION_PRODUCTION.md`**.
- Limites connues et dettes assumées : **`docs/KNOWN_LIMITATIONS.md`**.

## 1. Architecture mono-conseiller (rappel)

Un seul conseiller autorisé (`ATLAS_ALLOWED_EMAIL`, allowlist à une seule adresse, jamais un
annuaire), une seule base Postgres, un volume documentaire persistant, aucun scheduler interne (3
jobs déclenchés par un cron **externe**). Aucune notion de compte multi-utilisateur — voir
`docs/KNOWN_LIMITATIONS.md#pas-de-multi-utilisateur`.

## 2. Version déployée

- Noter ici, à chaque déploiement réel, le tag ou le hash de commit exact déployé en production
  (ex. `v1.0.0-rc1` ou `e0423f9`) et sa date. Aucun déploiement sans un identifiant exact tracé.

## 3. Prérequis avant tout déploiement réel

- Domaine + HTTPS réel actif.
- Postgres managé de production provisionné (distinct de tout Postgres local de dev/test).
- Volume documentaire persistant attaché (voir checklist ADR-047, section Stockage documentaire).
- Projet Google Cloud configuré (identité Atlas + Calendar/Gmail métier) — voir checklist ADR-047.
- Ensemble des variables d'environnement renseignées — voir checklist ADR-047 (ne pas la
  redupliquer ici).
- Stratégie de backup définie (section 6 ci-dessous).

## 4. Variables d'environnement (rappel des familles, valeurs dans ADR-047)

Application, Auth Atlas, Google métier, Endpoints techniques (Bearer), Stockage documentaire — noms
exacts et détail dans `apps/web/.env.local.example` et la checklist ADR-047. Aucune valeur secrète
n'est reproduite ici.

## 5. Jobs périodiques

| Job | Route | Méthode | Secret | Cadence | Résultat attendu | Vérification |
|---|---|---|---|---|---|---|
| JOB-01 | `/api/automatisations/scan` | POST | `AUTOMATISATIONS_SCAN_SECRET` | Quotidien | 200, run journalisé dans `/automatisations` | Consulter `/automatisations` après le déclenchement, vérifier un run récent sans `erreurTechnique`. |
| JOB-02 | `/api/automatisations/reprise` | POST | `AUTOMATISATIONS_REPRISE_SECRET` | Horaire | 200, aucune exécution restée bloquée | Vérifier `/automatisations` : aucune exécution en `a_traiter` anormalement ancienne. |
| JOB-03 | `/api/compatibilite/scan` | POST | `COMPATIBILITE_SCAN_SECRET` | Horaire | 200 | Réponse 200 constatée (pas d'UI dédiée de vérification fine en V1). |

`/api/compatibilite/baseline` (`COMPATIBILITE_BASELINE_SECRET`) — **jamais un cron**, geste manuel
explicite (dry-run par défaut). Ne pas le configurer comme un 4ᵉ job périodique.

Un Bearer invalide/absent sur ces 4 endpoints doit être refusé (jamais un traitement silencieux) —
vérifié une fois avant le premier jour de pilote (checklist ADR-047, section Validation).

## 6. Stockage documentaire et backup

- Attacher/vérifier le volume persistant et `ATLAS_DOCUMENT_STORAGE_DIR` — voir checklist ADR-047.
- **Un volume persistant n'est pas une sauvegarde.** Recommandation pilote (échelle mono-conseiller,
  faible volume) : procédure **manuelle documentée**, pas un moteur de backup automatisé —
  export périodique `pg_dump` (voir `docs/PROCEDURE_MIGRATION_PRODUCTION.md#3-sauvegarde-avant-migration-non-négociable`
  pour la commande) + copie périodique du contenu du volume documentaire, fréquence à définir par
  l'exploitant (ex. hebdomadaire) et à formaliser si l'usage grandit après le pilote.
- Test de validation exact à faire une fois en conditions réelles (non exécutable depuis cet audit,
  aucun accès Railway) : uploader un document réel → redéployer le service → retélécharger le même
  document → comparer les octets/le SHA-256 → régénérer un Pack Notaire → vérifier que l'historique
  des transmissions (ADR-049) reste intact après le redéploiement.

## 7. Séquence de déploiement

1. Vérifier le commit/tag à déployer (section 2).
2. Sauvegarde (`docs/PROCEDURE_MIGRATION_PRODUCTION.md`, étape 3).
3. Migration (`docs/PROCEDURE_MIGRATION_PRODUCTION.md`, étapes 4-5).
4. Déploiement du code.
5. Vérification post-déploiement :
   - [ ] Connexion réelle (`/connexion` → Google → session) fonctionne.
   - [ ] Cockpit (`/`) répond sans erreur 500.
   - [ ] Un document existant se télécharge toujours (stockage intact).
   - [ ] Les 3 jobs répondent 200 au prochain déclenchement.
   - [ ] Google Calendar/Gmail toujours connectés (ou reconnexion possible si révoqués).

## 8. Rollback

### Rollback code

Revenir au commit/tag précédemment déployé (section 2) — **sûr uniquement si ce commit précédent
est compatible avec le schéma de base actuellement en place**. Si la migration la plus récente a
supprimé/renommé une colonne que l'ancien code attend, un rollback code seul ne suffit pas : la
base doit alors aussi être restaurée (rollback données) ou la migration compensée manuellement.
Ne jamais supposer qu'un rollback code est automatiquement sûr sans avoir vérifié cette
compatibilité.

### Rollback données

Restauration du `pg_dump` réalisé avant la migration (`docs/PROCEDURE_MIGRATION_PRODUCTION.md`,
étape 3) — geste lourd (perte de toute donnée créée depuis la sauvegarde), jamais automatique,
réservé aux cas où le rollback code seul ne suffit pas. Décision qui revient à l'exploitant, jamais
déclenchée par défaut.

## 9. Incidents simples

| Symptôme | Piste de diagnostic |
|---|---|
| Atlas inaccessible | Logs de la plateforme d'hébergement + état du service (crash, redémarrage en boucle). |
| Login impossible | Vérifier `GOOGLE_ATLAS_REDIRECT_URI` et son enregistrement exact côté Google Cloud Console ; vérifier `ATLAS_ALLOWED_EMAIL`. |
| Documents en erreur 503 | Volume détaché, `ATLAS_DOCUMENT_STORAGE_DIR` absente/incorrecte, ou permissions insuffisantes — voir checklist ADR-047, section Stockage documentaire. |
| Jobs inactifs / non déclenchés | Vérifier la configuration du scheduler externe (aucun cron interne à Atlas) et la validité des secrets Bearer. |
| Google déconnecté (Calendar/Gmail) | Vérifier le badge de connexion sur `/` ; reconnexion via les liens `/api/auth/google/login` — la révocation Google est globale (Calendar + Gmail), voir `docs/KNOWN_LIMITATIONS.md`. |

Pas de système d'observabilité complexe en V1 — ces vérifications reposent sur les logs de la
plateforme d'hébergement et un contrôle manuel direct, cohérent avec un pilote à un seul
utilisateur actif qui constate lui-même une anomalie.

## 10. Code freeze (à partir de la validation V1 Candidate)

Aucune nouvelle fonctionnalité produit. Seules les catégories suivantes restent autorisées :
correction de bug, sécurité, stabilité, configuration pilote, correction fermant explicitement un
item des checklists V1 Candidate / Pilote réel. Toute évolution produit repasse post-pilote (voir
`docs/KNOWN_LIMITATIONS.md` pour la liste POST-V1).
