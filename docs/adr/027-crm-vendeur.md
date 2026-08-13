# ADR-027 — CRM vendeur / prise de mandat

**Statut :** Accepté
**Date :** 2026-08-13
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit complet du modèle existant (`schema.ts`, types, repositories, dashboard, moteur
d'alertes ADR-026) a établi qu'**aucune entité vendeur/propriétaire n'existait** jusqu'ici, nulle
part — ni table, ni type, ni mock réel. `biens` n'a aucun lien vers un propriétaire ; la seule
trace est la valeur `'vendeur_se_retire'` dans `MotifPerte` (ADR-020), sans structure associée. Un
bien ne pouvait donc exister qu'en étant créé directement par le conseiller, sans jamais être passé
par un cycle de prospection/qualification/estimation. Cette passe comble ce vide en amont du cycle
déjà modélisé (bien → mandat actif → offre → compromis → vente), en réutilisant systématiquement
les patrons déjà éprouvés (ADR-009/010/011/012/014/020) plutôt que d'en inventer de nouveaux.

Un tour de revue architecturale a validé la direction et demandé plusieurs corrections successives
avant codage, détaillées ci-dessous. Codage direct après incorporation, sans nouveau tour de plan.

## Décision

### 1. `prospects_vendeurs` = une opportunité, jamais un CRM contact générique

`prospects_vendeurs` (nouvelle table), type `ProspectVendeur` (`src/types/prospectVendeur.ts`),
représente en V1 **une opportunité commerciale de prise de mandat sur un bien potentiel, avec un
contact vendeur principal** — jamais une personne physique générique découplée de l'opportunité.
Limites V1 documentées explicitement dans le type lui-même :

- un seul contact principal par opportunité (`nom` obligatoire, `prenom` facultatif — un lead peut
  n'être connu que par son nom, ou correspondre plus tard à une SCI/indivision/succession) ;
- une seule opportunité par bien potentiel : `bien_id` porte une contrainte `UNIQUE` ;
- plusieurs propriétaires sur un même bien, ou un même propriétaire avec plusieurs biens,
  nécessiteront une séparation contact ↔ opportunité vendeur dans une passe ultérieure — **pas
  construite ici**.

`email`/`telephone` sont tous deux nullables, sans invariant croisé : un lead de prospection
terrain peut être enregistré avant même d'avoir une coordonnée de contact directe — Atlas
n'invente jamais une donnée manquante ni ne bloque la création du lead pour ce motif.

### 2. Statut dérivé de jalons — rendez-vous prévu ≠ rendez-vous réalisé, estimation prioritaire

Comme `deriverStatutCommercial` (ADR-014) : jamais stocké, dérivé à la lecture du jalon le plus
avancé déjà **réellement atteint**.

```ts
// Ordre d'affichage : prospect -> qualification -> rendez_vous -> estimation ->
// mandat_propose -> mandat_signe, perdu prioritaire depuis n'importe quel état.
function deriverStatutProspectVendeur(p: ProspectVendeur): StatutProspectVendeur {
  if (p.datePerte) return "perdu";
  if (p.mandatSigneLe) return "mandat_signe";
  if (p.mandatProposeLe) return "mandat_propose";
  if (p.estimationProposeeLe) return "estimation";
  if (p.rdvEstimationRealiseLe) return "rendez_vous";
  if (p.qualifieLe) return "qualification";
  return "prospect";
}
```

`rdv_estimation_prevu_le` (planifié) et `rdv_estimation_realise_le` (tenu) sont deux colonnes
`timestamptz` distinctes, avec heure (utile aux futurs agenda/rappels/automatisations) — seule la
seconde fait avancer le statut, un rendez-vous planifié dans le futur n'est jamais un jalon
commercial franchi. `estimation_proposee_le` est vérifié **avant** `rdv_estimation_realise_le` dans
la cascade : une estimation déjà chiffrée représente un stade plus avancé qu'un rendez-vous
seulement marqué réalisé — mais aucun ordre strict n'est imposé à la *saisie* (une estimation peut
être chiffrée avant même qu'un rendez-vous soit marqué réalisé), cette cascade ne fixe que la
représentation du stade le plus avancé. Seuls perte et signature sont terminaux ; chaque Server
Action de jalon ne vérifie que "pas perdu, pas déjà signé", sans séquence imposée entre eux.

### 3. Adresse précise et secteur approximatif, deux champs jamais fusionnés

`adresse_bien_potentiel` (précise) et `secteur_bien_potentiel` (description approximative, ex.
"quartier centre-ville") sont deux colonnes distinctes. Seule `adresse_bien_potentiel` peut
préremplir `biens.adresse` à la conversion (point 6) — un secteur flou ne devient jamais une
adresse.

### 4. `dernier_contact_le` : uniquement de vraies interactions, jamais une simple note interne

Une note n'est pas automatiquement une interaction. `notes_prospect_vendeur.type` distingue
explicitement les deux :

```ts
export const TYPES_NOTE_PROSPECT_VENDEUR = [
  "appel", "email", "sms", "rendez_vous", "autre_interaction", "note_interne",
] as const;
```

`dernier_contact_le` (timestamptz nullable sur `prospects_vendeurs`) est mis à jour
**exclusivement** par : (1) `ajouterNoteProspectVendeurAction` quand le type choisi n'est pas
`'note_interne'` ; (2) `marquerRdvEstimationRealiseProspectVendeurAction` (un rendez-vous tenu est
par nature une interaction, même sans note associée). Jamais par un simple jalon de pipeline
(`qualifieLe`/`estimationProposeeLe`/`mandatProposeLe`/`mandatSigneLe`, bookkeeping interne) ni par
`rdv_estimation_prevu_le` (planifié seulement). Indispensable pour que de futures règles
déterministes de relance (ADR-028/029) mesurent un vrai silence vendeur, jamais masqué par une
note interne ou une étape de pipeline bureaucratique.

### 5. `archive_le` distinct de `perdu`

`perdu` (`motif_perte`/`date_perte`, vocabulaire dédié ci-dessous) est un **résultat commercial** —
il entre dans les statistiques de conversion. `archive_le` (timestamptz nullable, même patron que
`biens`/`acquereurs`, ADR-012) est une **gestion administrative** de la fiche (doublon, erreur de
saisie) — jamais un résultat commercial, un prospect archivé n'entre jamais dans le taux de
conversion (point 8). Orthogonal au statut dérivé : un prospect archivé peut être dans n'importe
quel état.

Motif de perte : vocabulaire **dédié**, pas une réutilisation de `MotifPerte` (ADR-020, pensé pour
une transaction acquéreur déjà engagée, inadapté à une perte en prospection) :

```ts
export const MOTIFS_PERTE_PROSPECT_VENDEUR = [
  "projet_abandonne", "choix_agence_concurrente", "desaccord_estimation",
  "injoignable", "bien_vendu_autrement", "delai_calendrier", "autre",
] as const;
```

### 6. Conversion en bien — aucune donnée fictive, transaction atomique

`signerMandatProspectVendeurAction` : `parseSignatureMandatFormData` rejette explicitement toute
soumission dont un champ obligatoire de `biens` (référence, titre, adresse, ville, code postal —
au-delà des validations déjà portées par `parseBienFormData` sur surface/pièces/prix) resterait
vide, pré-rempli ou non depuis le prospect. Si `adresse_bien_potentiel` est vide, le champ adresse
du formulaire de conversion reste vide et obligatoire — un secteur flou ne le remplace jamais.
`prospectVendeurRepository.signerMandatProspectVendeur` exécute l'insertion du bien et la pose de
`mandat_signe_le`/`bien_id` dans **une seule transaction** (`getDb().transaction`, réutilise
`bienRepository.creerBien(input, executeur)` — même composition inter-repositories qu'ADR-019) :
aucun bien orphelin, aucun prospect marqué signé sans bien réel. `bien_id` porte une contrainte
`UNIQUE` (point 1) : une violation fait échouer la transaction dans son ensemble.

### 7. `prochaineAction`/`prochaineActionLe` seuls — `actions` non touchée

`prospects_vendeurs` porte deux champs simples, édités directement, sans file, sans statut, sans
récurrence — **pas un moteur de tâches**. Aucune modification de `src/db/schema.ts#actions`, de
`actionPriority.ts`, ni de la section "Dossiers nécessitant une action" de `/`. Le rattachement
propre des tâches/relances aux différents objets métier (bien, acquéreur, prospect vendeur) sera
tranché par un futur ADR-028 dédié au moteur de tâches.

## Contrat de types

```ts
export type StatutProspectVendeur =
  | "prospect" | "qualification" | "rendez_vous" | "estimation"
  | "mandat_propose" | "mandat_signe" | "perdu";

export type ProspectVendeur = {
  id: string; nom: string; prenom?: string; email?: string; telephone?: string;
  origineLead?: OrigineLead; origineLeadDetail?: string;
  adresseBienPotentiel?: string; secteurBienPotentiel?: string; ville?: string; codePostal?: string;
  typeBien?: TypeBien;
  qualifieLe?: string; estimationProposeeCentimes?: number; estimationProposeeLe?: string;
  rdvEstimationPrevuLe?: string; rdvEstimationRealiseLe?: string;
  mandatProposeLe?: string; mandatSigneLe?: string; bienId?: string;
  motifPerte?: MotifPerteProspectVendeur; datePerte?: string;
  prochaineAction?: string; prochaineActionLe?: string;
  dernierContactLe?: string; archiveLe?: string; creeLe: string; modifieLe: string;
};
```

## UX

- **`/prospects-vendeurs`** (liste) — même patron que `/clients`, deux dimensions de filtre
  indépendantes : archivage (`?vue=archives`) et issue commerciale (`en_cours` par défaut /
  `?vue=perdus` / `?vue=convertis`). Cartes triées par échéance de prochaine action (dépassées et
  proches en premier) — niveau "dashboard minimal" de la liste elle-même.
- **`/prospects-vendeurs/[id]`** (fiche) — identité, bien potentiel, pipeline (une `<details>` par
  jalon non encore franchi, aucun JS client), bloc perte/archivage, prochaine action éditable,
  notes append-only (typées interaction/interne), lien vers le bien si converti.
- **`/prospects-vendeurs/[id]/signer-mandat`** (page dédiée) — formulaire de conversion,
  pré-rempli depuis le prospect mais chaque champ obligatoire de `biens` reste éditable et vérifié.
- **`/prospects-vendeurs/nouveau`**, **`/prospects-vendeurs/[id]/modifier`** — CRUD standard.
- Nouvelle entrée nav "Prospects vendeurs" (`NavItems.tsx`).

## Dashboard minimal

Nouvelle section "Pipeline vendeur" sur `/dashboard` (`chargerPipelineVendeur()`,
`dashboardRepository.ts`) : compteurs par statut (prospects en cours uniquement, hors archivés),
volume d'estimations en cours, délai moyen prospect → mandat signé. Exception délibérée à la
convention "agrégation entièrement côté SQL" du fichier : le statut n'étant jamais une colonne
stockée, la fonction compose les listings déjà exposés par `prospectVendeurRepository` plutôt que
de dupliquer la dérivation en SQL — volume attendu faible (produit mono-conseiller).

**Ratio nommé explicitement** `tauxConversionOpportunitesCloturees` = signés / (signés + perdus),
**uniquement parmi les opportunités déjà clôturées** — libellé UI "Taux de conversion (parmi les
opportunités clôturées)", jamais "Taux de conversion" seul, pour ne jamais laisser croire que les
prospects encore en cours entrent dans le dénominateur. Prospects archivés exclus du numérateur et
du dénominateur.

## Conséquences

- Migration `0016_cute_doorman.sql` : tables `prospects_vendeurs` (28 colonnes, `bien_id` FK réelle
  vers `biens` + `UNIQUE`) et `notes_prospect_vendeur` (FK réelle vers `prospects_vendeurs`).
- Nouveaux types : `src/types/{prospectVendeur,origineLead,motifPerteProspectVendeur,
  noteProspectVendeur}.ts`.
- Nouveaux repositories : `src/lib/{prospectVendeurRepository,noteProspectVendeurRepository}.ts` ;
  `src/lib/bienRepository.creerBien` gagne un paramètre `executeur` optionnel (même principe que
  `marquerOffreEnCours`, ADR-019) pour la transaction de conversion.
- Nouvelles Server Actions : `src/actions/prospectVendeur.ts` ; parseurs :
  `src/lib/prospectVendeurFormulaire.ts`.
- Nouvelles pages : `src/app/prospects-vendeurs/{page,nouveau/page,[id]/page,[id]/modifier/page,
  [id]/signer-mandat/page}.tsx` ; composants `src/components/prospectVendeur/
  {ProspectVendeurFormulaire,ProspectVendeurConversionFormulaire}.tsx`.
- `dashboardRepository.ts` : `chargerPipelineVendeur()` ; `dashboard/page.tsx` : section "Pipeline
  vendeur".
- Tests : dérivation de statut (10 cas), parseurs (14 cas), repositories/notes/actions/dashboard en
  intégration Postgres (35 cas) — 51 tests dédiés, suite complète du projet passante (485 tests).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/
  `docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à des passes ultérieures : séparation contact ↔ opportunité (plusieurs
  propriétaires, un propriétaire multi-biens), relances automatiques, génération d'e-mails
  personnalisés, campagnes, posts de communication à la signature, moteur de tâches générique
  (ADR-028), intégration Google Calendar pour le RDV d'estimation, nouvelles règles du moteur
  d'alertes ADR-026, révocation d'un mandat déjà signé.
