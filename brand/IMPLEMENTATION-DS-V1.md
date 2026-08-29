# DOMIORA — Plan d'implémentation du Design System V1

**Source de vérité — Plan d'implémentation Design System V1**

Date de consolidation : 29 août 2026.

Aucun code produit à ce stade. Plan seul. Adossé à `brand/FONDATIONS.md` et `brand/DESIGN-SYSTEM-V1.md`.

Établi le 29 août 2026 sur `stiflouf/atlas@main` (arbre `1c92c8ad4922`). Décisions humaines complémentaires validées le 29 août 2026, intégrées ci-dessous directement dans les sections concernées.

---

## 0. Le levier mécanique, et le piège qui va avec

Tout le plan repose sur une propriété de Tailwind v4 : les classes du produit référencent des **noms** de tokens (`text-text-3`, `bg-surface-muted`, `border-border-md`), pas des valeurs.

**Conséquence favorable.** Changer la *valeur* d'un token en gardant son *nom* propage le changement dans tout le produit sans toucher un seul fichier d'écran. Le passage au navy `#02152B` se fait ainsi : une ligne de `globals.css`, et les ~474 occurrences relevées suivent.

**Conséquence défavorable, symétrique.** *Renommer* un token casse chaque classe qui le porte. Une recherche partielle — 400 fichiers scannés sur 556 candidats, arrêtée au budget de temps — a déjà relevé **474 occurrences** de `accent-light|champagne|text-3|surface-muted|border-md|navy-hover`. Le total réel est supérieur. Un renommage sec est donc exclu : ce serait une PR de plusieurs centaines de lignes mêlant tokens, écrans et composants, impossible à relire.

D'où la stratégie : **on change les valeurs tôt, on renomme tard, jamais dans la même PR.**

### ⚠ Piège de collision : l'échelle de rayons

Le DS nomme `sm 6 / md 8 / lg 12 / xl 16`. Tailwind nomme `lg = 8px` et `xl = 12px`. Ce sont deux échelles décalées d'un cran, et le produit utilise massivement `rounded-lg` (champs, boutons) et `rounded-xl` (cartes).

Redéfinir `--radius-lg: 12px` pour coller au DS ferait passer **tous les champs du produit de 8 à 12 px** silencieusement, sans qu'aucun fichier ne change — exactement l'effet de bord qu'on cherche à éviter.

**Décision : ne pas toucher à l'échelle Tailwind.** On mappe les noms du DS sur les utilitaires existants et on documente la correspondance :

| DS | px | Utilitaire Tailwind |
|---|---|---|
| sm | 6 | `rounded-md` |
| md | 8 | `rounded-lg` |
| lg | 12 | `rounded-xl` |
| xl | 16 | `rounded-2xl` |
| pill | ∞ | `rounded-full` |

Le produit est déjà conforme : champs en `rounded-lg` (8), cartes en `rounded-xl` (12). Rien à migrer sur les rayons — seulement à cesser de choisir au hasard dans les nouveaux composants.

---

## A. Fichiers de fondation à modifier

Trois fichiers, plusieurs PR (voir § F et § I pour le découpage exact en lots).

### A.1 `apps/web/src/app/globals.css`

**Bloc 1 — ajout des primitifs.** Une seule famille chiffrée : `ink` (`ink-900/800/700/600`), conformément à `brand/DESIGN-SYSTEM-V1.md` § 2.1. **Correction (sources désormais disponibles) :** les familles `ivory` / `stone` / `blue` évoquées dans une version antérieure de ce plan n'existent dans aucune source de vérité — elles ne sont pas créées. Chaque nouvelle surface neutre (`bg-page`, `bg-surface`, `bg-surface-subtle`, `bg-data`) est une valeur sémantique directe, sans primitif intermédiaire, exactement comme le fait déjà le produit pour `--color-page`/`--color-surface`. Purement additif : aucun consommateur, aucun risque.

**Bloc 2 — repointage des valeurs sur les tokens existants**, noms inchangés :

| Token (nom conservé) | Ancienne valeur | Nouvelle |
|---|---|---|
| `--color-navy` | `#071a3a` | `var(--color-ink-900)` = `#02152B` |
| `--color-navy-hover` | `#102a54` | `var(--color-ink-800)` = `#0B2440` |
| `--color-accent` | `#071a3a` | `var(--color-ink-900)` |
| `--color-accent-hover` | `#102a54` | `var(--color-ink-800)` |
| `--color-surface-muted` | `#f1ead9` | `var(--color-surface-subtle)` = `#F0EBE0` *(corrigé : pas de primitif `ivory-100`, voir Bloc 1)* |
| `--color-text-3` | `#8b8d9e` | `var(--color-text-muted)` = **`#696B7B`** *(décision validée, voir § J.1)* |
| `--color-warning` | `#92692c` | `var(--color-status-warning)` = **`#8A5E22`** *(décision validée, voir § J.2)* |
| `--color-warning-light` | `#f5ead4` | `var(--color-status-warning-subtle)` — valeur inchangée, déjà conforme |
| `--color-danger`, `--color-danger-light` | inchangées | aliasées vers `--color-status-danger`/`-subtle` — valeurs inchangées |
| `--color-success`, `--color-success-light` | inchangées | aliasées vers `--color-status-success`/`-subtle` — valeurs inchangées |
| `--color-border`, `--color-border-md` | inchangées | aliasées vers `--color-border-subtle`/`--color-border-default` — valeurs inchangées |

**Bloc 3 — ajout des sémantiques**, valeurs et noms tirés intégralement de `brand/DESIGN-SYSTEM-V1.md` § 2.2 à § 2.6 : `--color-surface-subtle`, `--color-data`, `--color-inverse` (surfaces) ; `--color-text-primary/-secondary/-muted/-disabled/-inverse` (texte) ; `--color-border-subtle/-default/-strong`, `--color-focus-ring` (bordures/focus) ; `--color-action-primary/-hover/-active` (actions) ; `--color-status-success/-warning/-danger/-info` + leurs variantes `-subtle`/`-border` (statuts, y compris `info`, nouvellement documenté et sans équivalent legacy). Additif. Les anciens noms deviennent alias — voir § D. Aucune valeur n'est déduite : chacune est recopiée depuis le Design System, sans invention.

**Bloc 4 — durées de mouvement** (`--motion-micro/enter/exit/move` + la courbe). Additif ; le produit utilise aujourd'hui `transition-colors` sans durée explicite, donc rien ne casse.

**Bloc 5 — emplacements or.** Commentaires seuls, `PENDING_MASTER_LOGO_ASSET`. Aucune valeur. Toujours bloqué — voir § J.3.

**Ce qui n'entre PAS dans ce fichier :** l'espacement. Tailwind le dérive de `--spacing` ; le produit utilise l'échelle par défaut (base 4), donc l'échelle du DS est **déjà en place**. Y toucher redimensionnerait tout le produit. Rien à faire — c'est une bonne nouvelle, pas un oubli.

### A.2 `apps/web/src/app/layout.tsx` — stratégie typographique corrigée

Substitution `Fraunces` → `Cormorant_Garamond` via `next/font/google`, variable CSS renommée en `--font-cormorant`, et `--font-serif` repointé dans `globals.css`.

**Contrainte non négociable : ne jamais déployer volontairement un état intermédiaire visuellement dégradé sur `develop` ou `main`.** La bascule seule (avant recalage des tailles) produit un rendu mesurablement dégradé — elle ne doit donc jamais être visible en production seule. D'où la scission en deux lots étanches (remplace l'ancienne mention d'une simple « PR distincte », § F.4b) :

- **Lot 8A — préparation technique.** Charger Cormorant Garamond via `next/font/google`, préparer la variable `--font-cormorant`. Ne **pas** repointer `--font-serif` si cela modifie le rendu visible. Cette PR doit être fusionnable sans aucun changement visuel notable.
- **Lot 8B — activation atomique.** Après validation des écrans Aujourd'hui et Biens, dans **une seule PR cohérente** : repointer `--font-serif` vers Cormorant Garamond, recalibrer tailles / line-height / weights des 7 fichiers concernés, produire une comparaison Fraunces avant / Cormorant après, vérifier desktop et mobile.

### A.3 `apps/web/tailwind` — rien

Pas de fichier de config à modifier : `@theme inline` dans le CSS est la config. Les breakpoints restent ceux de Tailwind, conformément à la validation.

---

## B. Primitives — à créer, à harmoniser, à ne pas créer

### B.1 À créer

**`Input` — priorité absolue.** La recherche a relevé la même chaîne de classes répétée dans au moins **40 emplacements** :

```
w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1
focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent
```

Présente dans `BienTabs.tsx` (une trentaine d'occurrences à elle seule), `BienFormulaire.tsx`, `AcquereurFormulaire.tsx`, `SecteursRechercheSection.tsx`, `ChampRecherche.tsx`, `visites/[id]/preparer/page.tsx`, `taches/nouveau/page.tsx`, `prospects-vendeurs/[id]/page.tsx`, `automatisations/page.tsx`. Trois fichiers l'ont déjà extraite en constante locale `const champ = …` — trois fois, séparément. C'est la dette la plus concentrée du produit.

`Textarea` et `Select` partagent la même base : même composant socle, trois wrappers.

**`Table`.** Aucun composant ; `dashboard/page.tsx` construit ses `<table>` à la main.

**`Tabs`.** `BienTabs.tsx` porte sa propre logique d'onglets (ligne 289 : `border-transparent text-text-3 hover:text-text-2`). La primitive doit **reprendre cette API**, pas la remplacer.

**`Dialog`, `Toast`, `Skeleton`, `Spinner`, `Tooltip`.** Aucun équivalent. `PhotosUploader.tsx` a une gestion d'état d'envoi (`succes` / `erreur` / `en_cours`) qui préfigure `Toast` : à lire avant.

### B.2 À harmoniser — API existante à préserver

**`Button`** — API saine (`variant` × `size`). Ajouts seuls : état `loading`, variante `link`. Le `secondary` cesse de changer de teinte au survol (déplacement de bordure). Aucune signature cassée.

**`Badge`** — c'est ici que le travail est réel. Six variantes de couleur portent quatre registres métier (statut, catégorie, système, priorité). Le DS leur donne une forme distincte. Cela change l'API : un `tone` devient un `registre` + un `ton`. À faire en dernier parmi les primitives, avec relecture des usages un par un.

**`Card`, `EmptyState`, `IconTile`, `StatTile`, `PropertyVisual`, `Avatar`, `SectionTitle`, `Pagination`** — passage aux tokens sémantiques uniquement. Aucun changement d'API.

**`ChampRecherche`** — à **conserver tel quel** dans son principe. Formulaire GET natif, sans JS obligatoire, partageable par URL (ADR-048). Il consomme simplement le futur `Input` à la place de sa chaîne de classes inline. Ne pas le transformer en composant client.

### B.3 À ne pas créer

Pas de `Section`, pas de `Stack`, pas de `Grid`, pas de `Text`. Le produit compose correctement en Tailwind ; ces wrappers ajouteraient une couche d'indirection sans rien résoudre.

---

## C. Dépendances entre étapes

```
A.1 globals.css (valeurs + sémantiques)
 ├──► B.2 primitives existantes → tokens sémantiques
 │     └──► F.4 écrans pilotes
 ├──► B.1 Input / Textarea / Select
 │     └──► remplacement des champs inline (par écran)
 └──► B.1 Table, Tabs, Dialog, Toast, Skeleton

A.2 layout.tsx (Cormorant) — Lot 8A
 └──► Lot 8B : recalage des tailles serif  [PR distincte, obligatoirement]

Sidebar / navigation ──► dépend de A.1 seul
BrandMark ────────────► BLOQUÉ, asset logo maître
Badge (refonte des registres) ──► après tous les autres composants
Suppression des alias ─────────► après migration complète
```

Deux chemins sont parallélisables sans conflit : tokens/primitives d'un côté, police/typographie de l'autre. Ils ne se croisent qu'aux écrans pilotes.

---

## D. Alias de compatibilité

Aucun ancien nom n'est supprimé avant § E. Chaque alias est une ligne de `globals.css` :

```css
--color-text-1: var(--color-text-primary);
--color-text-2: var(--color-text-secondary);
--color-text-3: var(--color-text-muted);

--color-surface-muted: var(--color-surface-subtle);

--color-border: var(--color-border-subtle);
--color-border-md: var(--color-border-default);

--color-navy: var(--color-ink-900);
--color-navy-hover: var(--color-ink-800);

--color-accent: var(--color-action-primary);
--color-accent-hover: var(--color-action-primary-hover);

--color-danger: var(--color-status-danger);
--color-danger-light: var(--color-status-danger-subtle);
--color-success: var(--color-status-success);
--color-success-light: var(--color-status-success-subtle);
--color-warning: var(--color-status-warning);
--color-warning-light: var(--color-status-warning-subtle);

--color-champagne / -light → PENDING (voir § J.3, or officiel)
```

`--color-text-disabled` (`#8B8D9E`) n'est **pas** un alias : c'est une valeur sémantique autonome (§ 2.3 du Design System), distincte de `text-muted`. Elle n'a aucun consommateur dans ce lot — voir § D.3 et § J.1.

**Trois cas qui ne sont pas de simples alias.**

**D.1 — `--color-accent-light` (`#f0e4cc`) — arbitrage définitif (décision validée).** Trois rôles sous un nom, identifiés dans le code :

| Usage relevé | Fichier | Destination |
|---|---|---|
| Fond de bouton d'onglet actif | `automatisations/page.tsx:109` | `bg-surface-subtle` |
| Survol de case à cocher | `TacheItem.tsx:36`, `BienTabs.tsx:1402` | `bg-surface-subtle` |
| Fond d'avatar/pastille | `prospects-vendeurs/page.tsx:165` | `stone-100` ou token neutre sémantique équivalent |

Le troisième usage **ne dépend plus de l'or** : un avatar n'est pas un marqueur de marque. Il reste néanmoins en alias inchangé jusqu'à la migration effective des trois consommateurs. Avant suppression de `--color-accent-light` (§ E), une recherche exhaustive de ses consommateurs est obligatoire — un premier passage a déjà trouvé des usages supplémentaires non recensés ici (`Badge.tsx`, `BrouillonEmailFormulaire.tsx`, `PrepObjections.tsx`, `ProspectVendeurTaches.tsx`) : la liste ci-dessus n'est probablement pas complète.

**D.2 — `--color-champagne` a des consommateurs de deux natures.** Certains sont décoratifs et peuvent attendre (`IconTile tone="champagne"`, ~12 emplacements). D'autres sont des **marqueurs sémantiques de marque** : le rail de `DossierActionCard.tsx:24` (« un rail champagne — marque, pas décor », dit le commentaire du code), le `border-t-2 border-t-champagne` de `BienAcquereursCompatibles.tsx:86`, les sur-titres de section (`page.tsx:149`, `biens/page.tsx:83`). Ceux-là sont précisément ce que l'or officiel devra porter. **Ne rien y toucher avant l'asset** (§ J.3).

**D.3 — Inventaire exhaustif des consommateurs de `--color-text-3` et décision finale (audit complet, 283 occurrences relevées sur `apps/web/src`, dont 282 consommateurs réels + 1 déclaration dans `globals.css`).**

| Catégorie | Nombre | Traitement |
|---|---:|---|
| A — texte muted réel | 278 | Migration mécanique, aucune ligne éditée : suit `--color-text-3 → var(--color-text-muted)` |
| B — texte disabled réel | 1 | `PhotosUploader.tsx:77` : `<label>` de bouton d'upload désactivé (`disabled` HTML + `cursor-not-allowed`) — migré explicitement vers `text-text-disabled` dans le Lot 1, seule ligne éditée pour ce point |
| C — objet / indicateur décoratif | 3 | `PhotosUploader.tsx:99`, `AgendaCard.tsx:18` (`muted: "bg-text-3"`), `pack-notaire/page.tsx:38` (`information: "bg-text-3"`) — **non édités**, voir décision ci-dessous |
| D — ambigu | 0 | — |

**Décision validée pour les 3 cas C :** ne pas les renommer en `bg-text-disabled` (un indicateur/pastille n'est pas un élément disabled — ce serait résoudre une dette de nommage en en créant une autre) et ne pas inventer un token neutre/`stone-400` dédié maintenant pour trois usages seulement. Ils conservent `bg-text-3` tel quel. **Conséquence explicitement acceptée :** ces trois pastilles passeront mécaniquement de `#8B8D9E` à `#696B7B` en même temps que tous les usages A, par héritage du repointage global — aucun enjeu WCAG (ce ne sont pas du texte), différence visuelle faible, fonction pleinement lisible dans les deux valeurs. Ce n'est donc plus un effet de bord silencieux mais une **dette sémantique documentée** : `bg-text-3` reste un token de texte utilisé comme couleur d'objet à ces trois emplacements, à remapper vers un vrai token neutre/indicateur **lorsque leurs composants respectifs (`PhotosUploader`, `AgendaCard`, le pack notaire) seront eux-mêmes migrés** dans un lot ultérieur — pas avant.

**D.4 — `#030A1C` (scrim média) — classification tranchée (décision validée, confirmée par `brand/DESIGN-SYSTEM-V1.md` § 2.8).** Présent dans `PropertyVisual.tsx` (3 occurrences), `PhotoPrincipale.tsx`, `BienHero.tsx`, `BienGaleriePhotos.tsx`, `app/biens/[id]/photos/page.tsx` — toujours en overlay translucide sur photographie (lisibilité de badges/textes), jamais en aplat de marque. Ce n'est **pas** le navy de marque : c'est une « **couleur fonctionnelle de lisibilité** » au sens du Design System. **Ne rien modifier sur ces cinq usages dans le Lot 1**, y compris dans `PropertyVisual.tsx` : les traiter isolément créerait la même incohérence visuelle que le plan cherche à éviter (H.1/H.2), puisque les quatre autres fichiers resteraient sur l'ancienne valeur. Un token `--color-media-scrim` est explicitement envisagé par le Design System (§ 2.8, § 14) mais **reporté à un lot ultérieur** ; ne pas l'introduire tant qu'il n'est pas nécessaire pour migrer les cinq consommateurs de façon atomique.

---

## E. Supprimable après migration

Dans cet ordre, et seulement après vérification qu'aucun consommateur ne subsiste :

1. `--color-accent` et `--color-accent-hover` — une fois `action-primary` adopté partout. Leur suppression est le vrai marqueur de fin : c'est l'alias qui masque la confusion marque/action.
2. `--color-accent-light` — une fois les trois consommateurs de D.1 effectivement migrés (arbitrages tranchés, plus les consommateurs supplémentaires identifiés à retrouver par la recherche exhaustive exigée en D.1).
3. `--color-text-1/2/3`, `--color-surface-muted`, `--color-border-md`, `--color-navy*` — renommage mécanique, une PR par famille, jamais toutes ensemble.
4. Les trois constantes locales `const champ = "w-full border border-border-md…"` — après adoption d'`Input`.
5. La logique d'onglets interne de `BienTabs.tsx` — après adoption de `Tabs`.
6. `--color-champagne` / `-light` — **en dernier**, une fois l'or officiel en place.

---

## F. Ordre exact des écrans

### F.1 → F.3 avant tout écran

1. **Lot 1** — `globals.css`, `PropertyVisual.tsx` et `Sidebar.tsx` selon le périmètre exact corrigé au § F.6 ci-dessous. Aucun autre fichier.
2. **Lot 2** — primitives existantes sur tokens sémantiques (`Button`, `Card`, `EmptyState`).
3. **Lot 3** — `IconTile`, `StatTile`, `Avatar`, `SectionTitle`, `Pagination` sur tokens sémantiques.
4. **Lot 4** — `Input` / `Textarea` / `Select` créés et adoptés par `ChampRecherche`.
5. **Lot 5** — `Sidebar`, navigation, shell, headers. `BrandMark` **non touché**.

### F.4 Écrans pilotes, dans l'ordre validé

1. **Aujourd'hui** (`app/page.tsx` + `components/aujourd-hui/`) — le plus vu, et le plus petit périmètre : 5 composants, 2 tests unitaires existants.
2. **Biens** (`app/biens/page.tsx`) — introduit les deux sorties de serif sur les prix, donc la première vérification réelle du choix Inter tabulaire.
3. **Fiche Bien** (`app/biens/[id]/page.tsx` + `components/bien/`) — le plus lourd : `BienTabs.tsx` fait ~1450 lignes et concentre l'essentiel des champs inline. Migration progressive obligatoire — voir § J.5 (décision validée).

**Lots 8A / 8B — recalage serif**, insérés entre Biens (lot 7) et Tabs/Table/Skeleton (lot 9) : voir § A.2 pour le détail de la scission en deux PR étanches. Remplace l'ancienne mention d'une PR unique « F.4b ».

### F.5 Propagation

Clients → Fiche Acquéreur → Prospects vendeurs → Visites → Fiscal → Automatisations → Pack Notaire → Dashboard → Communications.

`Dashboard` en fin de liste volontairement : c'est le seul écran à tableaux manuels, donc le premier consommateur réel de `Table` — il sert de validation de la primitive, pas de banc d'essai des tokens.

### F.6 Périmètre exact du Lot 1 (correction de contradiction — décision validée)

Le plan original était contradictoire : une section indiquait « `globals.css` seul » tandis que les risques (§ H.2) et le tableau des lots (§ I) identifiaient des navy hardcodés à corriger dans le même lot. Décision finale, qui fait foi :

Le **Lot 1** contient exactement :
- `apps/web/src/app/globals.css` ;
- `PropertyVisual.tsx`, **uniquement** pour les valeurs navy hardcodées correspondant réellement au navy de marque DOMIORA ;
- `Sidebar.tsx`, **uniquement** pour le dégradé navy hardcodé correspondant réellement au navy de marque DOMIORA ;
- `PhotosUploader.tsx`, **uniquement** la ligne 77 (`text-text-3` → `text-text-disabled`, seul vrai usage disabled identifié par l'audit exhaustif de § D.3).

Aucune autre modification structurelle ou fonctionnelle de ces quatre fichiers dans ce lot. Objectif : ne jamais déployer simultanément le nouveau navy canonique `#02152B` et d'anciens navy visuellement divergents servant au même rôle. L'audit préalable détaillant les occurrences exactes et leur classification fait l'objet d'une livraison séparée (hors de ce document).

**Arbitrages finaux, une fois `brand/FONDATIONS.md` et `brand/DESIGN-SYSTEM-V1.md` disponibles :**
- `PropertyVisual.tsx` : le dégradé `#0b1f42 → #020817` (panneau « neutre », H.2) est du navy de marque et devient `ink-800 → ink-900` (`from-ink-800 to-ink-900`), par cohérence avec le traitement de `Sidebar.tsx`.
- `Sidebar.tsx` : dégradé SVG `#102a54 → #071a3a` devient `#0B2440 → #02152B` (valeurs littérales, attribut `stopColor` non stylable par classe Tailwind).
- `#030A1C` (scrim média, `PropertyVisual.tsx` inclus) : classé couleur fonctionnelle distincte, **hors périmètre du Lot 1** — voir § D.4.

---

## G. Tests à prévoir

Le dépôt contient **~200 fichiers de test** (Vitest + Playwright). Presque tous portent sur la logique métier et ne sont pas concernés. Trois catégories le sont.

**G.1 — Tests structurels qui lisent le source.** `Sidebar.structurel.test.ts` parse `Sidebar.tsx` au `readFileSync` et vérifie qu'aucune classe `h-[clamp(...)]` n'autorise un minimum de `0px`, et qu'aucun `calc(100vh - Npx)` ne réapparaît dans une classe de hauteur. C'est un garde-fou de régression sur la zone photographique de la sidebar. **Toute retouche de `Sidebar.tsx` en Lot 1 ou Lot 5 doit le laisser vert sans le modifier.** S'il devient rouge, c'est le code qui a tort, pas le test.

**G.2 — Tests de rendu qui interrogent le DOM.** `page.test.tsx`, `biens/page.test.tsx`, `BienHero.test.tsx`, `AcquereurHero.test.tsx`, `TacheItem.test.tsx`, `AgendaCard.test.tsx`, etc. Ils cherchent des textes et des rôles, pas des classes — donc a priori insensibles au restyling. **À vérifier avant chaque PR** : un test qui assertait une classe deviendrait un faux négatif.

**G.3 — E2E.** `coeur.smoke.spec.ts` et `documents-adr049.smoke.spec.ts`. À exécuter après chaque PR de fondation (Lots 1, 2, 5) et après chaque écran pilote. Ce sont eux qui attraperont une régression de navigation ou de formulaire.

**Tests à ajouter.** Trois, pas plus :

1. Un test de non-régression sur `globals.css` : chaque alias déprécié résout vers un token existant (attrape une suppression prématurée — le risque du § E).
2. Un test de contraste automatisé sur les paires du DS, calculé sur `bg-page` — y compris désormais `text-muted #696B7B` et `warning #8A5E22`/`#F5EAD4` (§ J.1, § J.2). C'est exactement l'erreur commise dans la planche initiale en mesurant sur `bg-surface` : un test l'aurait vue.
3. Un test structurel sur `BrandMark.tsx` vérifiant qu'il **n'est pas modifié** tant que l'asset n'est pas là — un garde-fou contre le contournement du blocage, dans l'esprit de G.1.

---

## H. Risques de régression

| # | Risque | Probabilité | Détection |
|---|---|---|---|
| H.1 | Le navy `#02152B` change **toutes** les surfaces navy d'un coup (sidebar, boutons, hero, dégradés). Effet voulu, mais massif et immédiat. | certaine | revue visuelle, Lot 1 |
| H.2 | Valeurs navy **en dur** hors tokens : `#0b1f42`→`#020817` dans `PropertyVisual.tsx` (devient `ink-800`→`ink-900`), dégradé `#102a54`→`#071a3a` dans le SVG de `Sidebar.tsx` (devient `#0B2440`→`#02152B`). Elles ne suivront pas et créeraient un écart de teinte visible si non corrigées. | certaine | corrigé dans Lot 1 (valeurs de remplacement tranchées, § F.6) |
| H.3 | `#F0EBE0` remplaçant `#F1EAD9` : écart faible mais présent sur des dizaines de surfaces. | certaine | revue visuelle |
| H.4 | Redéfinir l'échelle de rayons Tailwind ferait passer tous les champs de 8 à 12 px sans qu'aucun fichier ne change. | évitée par § 0 | — |
| H.5 | `BienTabs.tsx` (~1450 lignes, ~30 champs inline) migré en une PR : impossible à relire. | élevée | découpage par onglet imposé (§ J.5, décision validée) |
| H.6 | Refonte de `Badge` : changement d'API sur un composant partagé par presque tous les écrans. | élevée | migration en dernier, usage par usage |
| H.7 | Bascule Cormorant sans recalage : hiérarchie visuellement dégradée entre l'activation et le recalage. | anciennement certaine — **éliminée par la scission Lot 8A / Lot 8B** (§ A.2) | aucun état dégradé ne doit plus être déployé |
| H.8 | `text-text-3` utilisé comme fond (D.3) : renommage trompeur à trois endroits, une fois `text-3` réaliasé vers `text-muted`. | moyenne, sans risque de régression visuelle | décision validée : migration différée à la PR qui touchera ces composants (§ D.3), pas dans le Lot 1 |
| H.9 | Migration d'un composant partagé sans mesurer ses consommateurs — `IconTile` est utilisé dans au moins 12 fichiers. | moyenne | recherche avant chaque PR |
| H.10 | Mobile non vérifié : la sidebar a une navigation mobile distincte, et `Sidebar.structurel.test.ts` documente un bug de viewport bas déjà survenu. | moyenne | vérification 390 px + viewport court |

---

## I. Lots / commits recommandés

Treize lots (le lot 8 est scindé en 8A/8B, § A.2 et § J.7). Chacun est relisible seul et déployable seul.

| Lot | Contenu | Fichiers touchés |
|---|---|---|
| 1 | Fondations couleur : primitifs + sémantiques + alias + navy canonique `#02152B` + surfaces + `text-muted #696B7B` + `text-disabled #8B8D9E` + `warning #8A5E22`/`#F5EAD4` + navy hardcodés pertinents (§ F.6) | `globals.css`, `PropertyVisual.tsx`, `Sidebar.tsx`, `PhotosUploader.tsx` (périmètre exact § F.6) |
| 2 ✅ | `Button` (+ `loading`), `ButtonLink` (nouveau), `Card`, `EmptyState` sur sémantiques | `globals.css`, `Button.tsx`, `ButtonLink.tsx` (créé), `Card.tsx`, `EmptyState.tsx`, `app/page.tsx`, `app/biens/page.tsx`, `ProspectVendeurBienCree.tsx`, `AcquereurHero.tsx`, `BienStatutAction.tsx` |
| 3 ✅ | `IconTile`, `StatTile`, `SectionTitle`, `Pagination` (`Avatar` : aucune modification recommandée) | `IconTile.tsx`, `StatTile.tsx`, `SectionTitle.tsx`, `Pagination.tsx` |
| 4 ✅ | `Input` / `Textarea` / `Select` créés (natifs, sans hook, Server Component compatibles) + `ChampRecherche` adopté | `fieldStyles.ts` (créé), `Input.tsx`, `Textarea.tsx`, `Select.tsx` (créés), `ChampRecherche.tsx` |
| 5 ✅ | `NavItems` + `BottomNav` (tokens + `aria-label`/`aria-current`) + une ligne texte de `Sidebar` — `BrandMark`/`AppShell` exclus, pas de `PageHeader` créé | `NavItems.tsx`, `BottomNav.tsx`, `Sidebar.tsx` (1 ligne) |
| 6 ✅ | Écran **Aujourd'hui** | `app/page.tsx`, `AgendaCard.tsx`, `TacheItem.tsx`, `DossierActionCard.tsx`, `ConnexionsGoogle.tsx`, `ConfirmationBienRdv.tsx`, `AlerteCard.tsx` |
| 7 ✅ | Écran **Biens** (liste) — `font-serif` des prix conservé (précédent réel, pas une sortie), `tabular-nums` ajouté | `app/biens/page.tsx` |
| 8A ✅ | **Préparation Cormorant** — chargement de la police, `--font-cormorant`, sans activation visuelle globale | `layout.tsx` |
| 8B ✅ | **Activation Cormorant** + recalage serif atomique, un seul commit cohérent | `layout.tsx`, `globals.css`, 6 écrans, 5 composants |
| 9 | ⚠ **ARBITRÉ — primitives différées faute de consommateurs suffisants** (§ J.17) | aucun fichier runtime, `IMPLEMENTATION-DS-V1.md` seul |
| 10 | **Fiche Bien**, une PR par onglet ou unité fonctionnelle de `BienTabs` (§ J.5) — 10A ✅ (§ J.18), 10B+ à venir | `components/bien/`, `ui/Tabs.tsx` |
| 11 | `Dialog` + `Toast` créés, adoptés sur les flux destructifs | ~5 fichiers |
| 12 | Refonte `Badge` (registres) | transverse, en dernier |

Puis, hors séquence : propagation § F.5, arbitrage effectif des consommateurs de `accent-light` (§ D.1, décision déjà tranchée — reste la migration), suppression des alias (§ E). Et, **quand l'asset logo arrivera** : tokens or → `BrandMark` → marqueurs de marque de D.2.

Workflow de dépôt à respecter pour chaque lot, sans exception : **feature → develop → main**, jamais de branche longue dédiée à toute une famille de lots (§ J.5).

---

## J. Décisions et points de validation

### J.1 ✅ Résolu — `text-muted`

*Historique (pour mémoire) :* la validation initiale fixait `text-muted: #6E7080`. Mesure sur `bg-page #F6F2EA` : 4,38:1, sous le seuil AA de 4,5:1 pour du texte courant — elle ne passait que sur `bg-surface` (4,78:1), alors que `text-3` porte aujourd'hui des messages affichés sur le fond de page (dont ceux d'`EmptyState`). La planche initiale avait mesuré par erreur sur la surface plutôt que sur le fond de page.

**Décision validée :** `text-muted = #696B7B` (≈ 4,71:1 sur `bg-page`, conformité AA, écart visuel négligeable avec `#6E7080`). `#6E7080` est abandonné. `#8B8D9E` devient `text-disabled` — un token sémantique autonome et documenté (`brand/DESIGN-SYSTEM-V1.md` § 2.3), pas un texte courant. Les usages de `text-3` qui servent aujourd'hui de couleur d'objet plutôt que de texte (§ D.3) ne sont pas rebasculés vers `text-disabled` dans le Lot 1 — ils suivent `text-muted` par l'alias existant, sans régression visuelle, et seront retraités avec leurs composants.

### J.2 ✅ Résolu — `warning`

*Historique (pour mémoire) :* la validation initiale demandait de conserver `#92692C` / `#F5EAD4` provisoirement, l'arbitrage face à l'or étant reporté après extraction. Mais `#92692C` sur `#F5EAD4` ne donne que 4,11:1 — non conforme AA, indépendamment de toute question d'or, donc non conforme **dès aujourd'hui en production**.

**Décision validée :** `warning foreground = #8A5E22` (4,75:1 sur `#F5EAD4`), `warning subtle background = #F5EAD4` (inchangé). Le contraste est corrigé maintenant, sans attendre l'or. La proximité visuelle éventuelle avec le futur or officiel DOMIORA reste réévaluable une fois l'asset maître disponible — ce point-là seul reste ouvert, pas le contraste.

### J.3 ⛔ Toujours bloqué — asset du logo maître

Rien à valider, tout à fournir. Vectoriel d'origine, ou PNG ≥ 1024 px, symbole seul, fond transparent, sans texte ni cadre. Bloque : les tokens or, `BrandMark`, et les marqueurs de marque de D.2.

Interdictions absolues, maintenues sans exception :
- aucun substitut ;
- aucun SVG approximatif ;
- aucun D typographique ;
- aucune flamme recréée ;
- aucune extraction de couleur depuis la vignette ;
- aucune génération IA ;
- aucune approximation CSS.

`BrandMark` reste intact tant que l'asset maître propre n'est pas fourni.

### J.4 ✅ Résolu — arbitrage de `--color-accent-light`

Voir détail complet en § D.1. Les trois usages identifiés sont tranchés (deux vers `bg-surface-subtle`, un vers `stone-100`/équivalent neutre) ; le troisième ne dépend plus de l'or. Reste à exécuter : la migration effective des consommateurs, précédée d'une recherche exhaustive avant toute suppression de `--color-accent-light` — un premier passage a déjà trouvé des consommateurs non recensés dans le tableau initial (`Badge.tsx`, `BrouillonEmailFormulaire.tsx`, `PrepObjections.tsx`, `ProspectVendeurTaches.tsx`).

### J.5 ✅ Résolu — ampleur du découpage de `BienTabs.tsx`

**Décision validée :** migration progressive, une PR par onglet ou unité fonctionnelle suffisamment petite. Pas de branche longue dédiée contenant toute la migration avant revue. Chaque étape doit être relisible, testable, déployable, réversible, sans changement métier simultané, et permettre au fichier de fonctionner avec une partie ancienne et une partie migrée. Workflow normal du dépôt : feature → develop → main.

### J.6 Ce qui n'est toujours PAS dans ce plan, faute d'information

- **Le nombre exact de consommateurs par token.** Le scan a été borné (400 fichiers sur 556, arrêt au budget de temps). 474 occurrences relevées, total réel supérieur. Un inventaire exhaustif est à produire côté dépôt avant le lot de renommage — pas avant le Lot 1, qui ne renomme rien.
- **Le comportement de la navigation mobile.** `Sidebar.tsx` n'a pas été lu en entier au-delà de sa zone structurelle testée. Le plan la traite comme une boîte noire à ne pas casser (§ G.1), pas comme un objet à redessiner.
- **Les valeurs or.** Par construction — bloquées par § J.3.
- **La primitive `stone-400`** évoquée en § D.3 pour les trois usages « couleur d'objet » de `text-3` reste non chiffrée — décision validée : ne pas l'inventer maintenant, la définir seulement quand ces composants seront migrés.
- **Le token `--color-media-scrim`** (§ D.4) : envisagé par le Design System (§ 2.8, § 14) mais sans valeur ni périmètre de migration définis. Reporté à un lot ultérieur.

### J.8bis ✅ Résolu — inventaire exhaustif de `--color-text-3` et arbitrage final

Voir détail complet en § D.3. Sur 282 consommateurs réels : 278 migrent mécaniquement vers `text-muted` (`#696B7B`), 1 (`PhotosUploader.tsx:77`) migre explicitement vers `text-disabled` (`#8B8D9E`) dans le Lot 1, et 3 (`PhotosUploader.tsx:99`, `AgendaCard.tsx:18`, `pack-notaire/page.tsx:38`) restent sur `bg-text-3` — dette sémantique documentée et acceptée, sans enjeu WCAG, à remapper vers un token neutre lors de la migration de leurs composants respectifs.

### J.8 ✅ Résolu — sources de vérité disponibles

`brand/FONDATIONS.md` et `brand/DESIGN-SYSTEM-V1.md` sont désormais présents dans le dépôt et font foi pour toutes les valeurs de primitifs et de sémantiques citées dans ce document. Le Lot 1 n'est plus limité à un sous-ensemble minimal : l'intégralité des primitifs `ink` et des sémantiques de couleur documentés (§ 2.1 à § 2.6 du Design System) est incluse, à l'exclusion des points explicitement hors périmètre (or § J.3, scrim média § D.4, usages différés § D.3).

### J.9 ✅ Lot 2 appliqué — Button/ButtonLink/Card/EmptyState

Ajouts : tokens `--shadow-surface`/`--shadow-floating`/`--shadow-modal` (§ 6 du Design System, `shadow-modal` non consommé) ; `ButtonLink` (nouveau composant, jamais de `<button>` imbriqué dans un `<a>`) ; `Button` gagne `loading?: boolean` (spinner `LoaderCircle`, `aria-busy`, `disabled` garantis prioritaires sur toute prop contradictoire du consommateur) et la variante canonique `destructive` (`danger` conservé comme alias déprécié, non supprimé). `Card` et `Button` migrent vers les tokens sémantiques directs (`border-subtle`/`-default`, `action-primary`, `text-inverse`, `focus-ring`, `status-danger`) partout où la correspondance était certaine. `secondary` ne recolore plus le texte au hover (uniquement la bordure), conformément à la direction validée. `EmptyState` compose désormais son CTA avec `ButtonLink` et son message utilise directement `text-muted` (plus l'alias `text-3`).

**✅ Résolu (micro-commit séparé, avant Lot 3) :** `ProspectVendeurHero.tsx` contenait le même pattern invalide `<Link><Button></Link>` (2 occurrences) que celui corrigé dans les 4 fichiers du Lot 2, découvert par la recherche exhaustive post-migration mais hors périmètre de ce lot. Migré vers `ButtonLink` dans un commit dédié. Recherche exhaustive relancée après ce correctif : aucune occurrence du pattern ne subsiste dans `apps/web/src`.

### J.10 ✅ Lot 3 appliqué — IconTile/StatTile/SectionTitle/Pagination

`IconTile` : tone `muted` migré vers `bg-surface-subtle text-text-secondary` (valeurs identiques) ; tone `navy` migré vers `bg-inverse text-champagne` (décision validée : `bg-inverse` décrit mieux la fonction d'une petite surface sombre/inversée que l'alias historique `bg-navy`, même valeur `#02152B`) ; tones `champagne` et `sur-navy` **toujours bloqués**, inchangés — y compris leurs usages dans `EmptyState` et `StatTile`.

`StatTile` : `border-border`→`border-border-subtle`, `text-text-1`→`text-text-primary`, `text-text-3`→`text-text-muted`, `text-surface`→`text-text-inverse` (valeurs identiques). Alignement délibéré sur les tailles Data/Data large du Design System (§ 3) : `compact` 15px/600→14px/500, `kpi`/`lead` 22px/600→24px/600 — changement visuel mineur intentionnel, pas un simple renommage de token. `tabular-nums` ajouté sur la valeur. `lead` conserve `bg-navy`/`border-navy`/`text-champagne` inchangés.

`Avatar` : **aucune modification** — confirmé n'utiliser ni `accent-light` ni aucun token nécessitant une migration ; son `text-champagne` reste bloqué comme les autres. La « pastille d'avatar en accent-light » de § D.1 n'est pas ce composant : c'est un `<div>` manuel indépendant dans `prospects-vendeurs/page.tsx`, non touché par ce lot.

`SectionTitle` : uniquement `text-text-3`→`text-text-muted`. Les 13 duplications manuelles de sa classe exacte (`ProspectVendeurHero.tsx`, `PatrimoineEtHistoire.tsx`, `VieAutourDuBien.tsx`, `ProspectVendeurTaches.tsx`, `TransmissionNotaireFormulaire.tsx`, `SecteursRechercheSection.tsx`, `BienTabs.tsx`, `visites/[id]/preparer/page.tsx`, `prospects-vendeurs/[id]/page.tsx`, `dashboard/page.tsx`, `clients/[id]/page.tsx`, `biens/[id]/page.tsx`, `biens/[id]/pack-notaire/page.tsx`) restent une dette connue, non migrées — elles bénéficient déjà de la correction `text-muted` du Lot 1 via le même alias, sans risque de contraste.

`Pagination` : tokens `border-border`→`border-border-subtle`, `text-accent`→`text-action-primary`, `hover:text-accent-hover`→`hover:text-action-primary-hover`, `text-text-3`→`text-text-muted` (valeurs identiques) ; ajout accessibilité `aria-label="Pagination"` sur le `<nav>` et `aria-current="page"` sur l'indicateur de page — sans changement visuel, sans toucher aux `href`/`construireHref`/architecture ADR-048. Reste volontairement un lien texte simple, non composé avec `ButtonLink`.

**Points laissés ouverts, non tranchés dans ce lot (informationnels uniquement) :** l'écart `text-[15px]`/`text-[22px]` n'était pas propre à un cas bloquant — désormais résolu par l'alignement Data/Data large ci-dessus. Aucun autre point ouvert.

### J.11 ✅ Lot 4 appliqué — Input/Textarea/Select natifs + adoption par ChampRecherche

Trois primitives natives minimales (`InputHTMLAttributes`/`TextareaHTMLAttributes`/`SelectHTMLAttributes` + `className`, aucune prop custom, aucun `variant`/`size`/`error`, aucun hook, aucun `forwardRef` — aucun consommateur réel ne le requiert) partageant `FIELD_BASE_CLASSES` (`apps/web/src/components/ui/fieldStyles.ts`, concaténation simple, aucune dépendance ajoutée) : `w-full border border-border-default rounded-lg px-3 py-2 text-[14px] text-text-primary bg-data`, focus `outline-2 outline-offset-2 outline-focus-ring` sur `:focus` (pas `:focus-visible`, un champ édité doit rester visible même après un clic souris). `bg-data` (`#FFFFFF`) consommé pour la première fois, conformément à DESIGN-SYSTEM-V1.md § 2.2. Nouvelle stratégie de focus adoptée délibérément à la place de l'ancienne recette `ring-accent/20` — abandonnée pour les nouvelles primitives, jamais recréée.

`ChampRecherche.tsx` adopte `Input` (`className="pl-9 pr-3"` pour l'icône) sans devenir client, sans changer `method="GET"`, `action`, `name="q"`, `defaultValue`, `champsCaches` ni l'architecture ADR-048. Cascade `px-3` (base) vs `pl-9`/`pr-3` (override) vérifiée dans le CSS compilé du build : `pl-9`/`pr-3` (propriétés physiques) suivent `px-3` (`padding-inline`) dans l'ordre du fichier généré et l'emportent bien sur leurs côtés respectifs.

**Aucun état error/disabled/readonly stylé** — audit exhaustif confirmé : zéro usage réel de `aria-invalid`, `disabled`, `readOnly` sur un champ dans tout le produit. Ces attributs natifs restent transmis mécaniquement par le spread, simplement non stylés tant qu'aucun consommateur réel n'en a besoin.

**Dettes documentées, non traitées ce lot :** les 69 autres occurrences de l'ancienne recette (`border-border-md`/`text-text-1`/`ring-accent`) dans 21 fichiers (dont `BienTabs.tsx`, réservé au Lot 10) ; ~22 `<label>` non associés via `htmlFor`/`id` (correction écran par écran, pas une primitive) ; le `placeholder` de `ChampRecherche` comme seul indice textuel (décision de contenu, pas ajouté arbitrairement) ; la variante compacte entrevue dans 3 `<select>` de `BienTabs.tsx` (`size`, à réévaluer au Lot 10 avec le contexte réel).

### J.12 ✅ Lot 5 appliqué — shell/navigation, périmètre volontairement réduit

L'audit a montré que les Lots 1-3 avaient déjà propagé la quasi-totalité des corrections mécaniques possibles au shell : `bg-navy` et le dégradé SVG de `Sidebar.tsx` étaient déjà corrects depuis le Lot 1. Le Lot 5 réel se limite donc à `NavItems.tsx`, `BottomNav.tsx` et une seule ligne de `Sidebar.tsx` :

- `aria-label="Navigation principale"` et `aria-current={active ? "page" : undefined}` ajoutés aux deux variantes (`sidebar`/`bottom`) de `NavItems` — purement additif, la logique `active` (`pathname === "/"` / `pathname.startsWith(href)`) reste strictement inchangée.
- `text-white`/`text-white/65`/`text-white/55`/`hover:text-white` → `text-text-inverse` (et ses variantes d'opacité) pour le foreground texte/icône de la navigation sidebar sur navy ; `text-white/90` → `text-text-inverse/90` pour le nom du conseiller dans `Sidebar.tsx`. `#FFFFFF` devient `#FFFCF7`, conformément à § 2.3 du Design System — écart imperceptible, vérifié dans le CSS compilé (`color-mix`/`lab()` corrects pour chaque opacité).
- `text-text-3` → `text-text-muted` (nav bottom, état inactif) ; `border-border` → `border-border-subtle` (`BottomNav`). `text-navy` (état actif nav bottom) volontairement conservé — aucun token `navigation-active` dédié n'existe, pas inventé.
- **Overlays blancs conservés à l'identique** (`bg-white/[0.08]`, `hover:bg-white/5`, `border-white/10`) : `text-inverse` est un token de texte, pas un remplacement générique du blanc translucide — aucun token sémantique pour ces overlays n'existe dans le DS, aucun inventé.
- Champagne/or entièrement intacts (barre + pastille active de nav, avatar conseiller, silhouette SVG) — bloqués comme prévu.
- `BrandMark.tsx` et `AppShell.tsx` absents du diff, aucune exception.
- Aucune primitive `PageHeader` créée : les `<h1>` des 7 écrans principaux utilisent 3 tailles différentes et un mélange serif/Inter incohérent (Aujourd'hui/Biens/Clients/Fiscal/Automatisations en `font-serif`, Prospects vendeurs/Tableau de bord en Inter, sans règle documentée) — dette réelle, non résolue ici, renvoyée aux Lots 8A/8B puis à la propagation écran par écran.
- **Dette fonctionnelle documentée, hors sujet tokens** : aucun contrôle de déconnexion visible dans le shell (le bloc « Steven Gausset » est un texte statique) — l'action serveur `/api/auth/atlas/logout` existe mais n'est reliée à aucune UI. À qualifier pour un chantier fonctionnel séparé, pas un lot de migration visuelle.

### J.13 ✅ Lot 6 appliqué — écran pilote « Aujourd'hui »

L'écran était déjà largement composé avec les primitives V1 (`Card`, `IconTile`, `StatTile`, `SectionTitle`, `EmptyState`, `ButtonLink`) depuis les Lots 2-3. Le Lot 6 se limite donc à la migration lexicale des alias historiques restants vers les tokens sémantiques, dans `app/page.tsx` et `components/aujourd-hui/` (+ `components/alertes/AlerteCard.tsx`, seul consommateur = Aujourd'hui) :

- `text-text-1/2/3` → `text-text-primary/secondary/muted`, `border-border` → `border-border-subtle`, `divide-border` → `divide-border-subtle`, `border-border-md` → `border-border-default`, `bg-surface-muted` → `bg-surface-subtle`, `text-accent`(`-hover`) → `text-action-primary`(`-hover`), `hover:border-accent` → `hover:border-action-primary` — appliqués dans `page.tsx`, `AgendaCard.tsx`, `TacheItem.tsx`, `DossierActionCard.tsx`, `ConnexionsGoogle.tsx`, `ConfirmationBienRdv.tsx`, `AlerteCard.tsx`.
- `TacheItem.tsx` : hover de la case à cocher `hover:bg-accent-light` → `hover:bg-surface-subtle` (destination déjà validée en § J.4). Se propage visuellement à la Fiche Acquéreur (`app/clients/[id]/page.tsx`, consommateur non modifié) — testé (`page.test.tsx` de cette route, vert).
- Greeting (`text-champagne`), H1 (`font-serif`), rail champagne de `DossierActionCard`, et tous les tons champagne/navy/muted de `TON_ICONE_NIVEAU` (`AlerteCard`) laissés strictement intacts — bloqués comme prévu (asset logo, § J.3) ou hors sujet (typographie, Lots 8A/8B).
- `AgendaCard.tsx` : `DOT_COLOR.muted = "bg-text-3"` volontairement conservé tel quel — aucun token sémantique de statut neutre n'existe encore pour cet usage d'indicateur (pas de texte), dette déjà actée en § J.8bis, non ré-ouverte ici.
- `Badge.tsx` non touché (registres reportés au Lot 12, § I) ; aucune primitive stabilisée (`Card`, `IconTile`, `StatTile`) rouverte ; aucune logique métier modifiée.
- Tests : suites existantes `AgendaCard.test.tsx`, `TacheItem.test.tsx`, `app/page.test.tsx`, `app/clients/[id]/page.test.tsx` (propagation TacheItem) vertes sans modification ; suite Vitest complète 182/182 fichiers, 1454/1454 tests ; `tsc --noEmit` et `next build` propres.
- E2E : Chromium installé (`pnpm exec playwright install chromium`, aucun fichier versionné modifié) ; `coeur.smoke.spec.ts` exécuté — l'assertion `heading "Aujourd'hui"` (seule concernée par ce lot) passe ; un échec sans rapport avec ce lot subsiste plus loin dans le même parcours, sur la fiche Bien (`/biens/[id]`, fichier non touché par le Lot 6) — dette distincte à qualifier séparément.
- Validation visuelle desktop/mobile réalisée via session authentifiée réelle (script Playwright jetable, non conservé) : aucune anomalie constatée.

### J.14 ✅ Lot 7 appliqué — écran liste « Biens »

L'audit a montré que l'écran était déjà entièrement composé avec les primitives V1 (`Card`, `ButtonLink`, `ChampRecherche`, `Pagination`, `EmptyState`, `SectionTitle`, `Badge`, `PhotoPrincipale`/`PropertyVisual`) — le périmètre réel se limite à un seul fichier, `app/biens/page.tsx` :

- `text-text-1/2/3` → `text-text-primary/secondary/muted`, `border-border` → `border-border-subtle`, `text-accent`(`-hover`) → `text-action-primary`(`-hover`) — appliqués sur le header, les deux layouts de card (desktop grille / mobile liste) et leurs métadonnées (titre, adresse, surface/pièces, référence, date d'archivage, chevron).
- `tabular-nums` ajouté aux deux affichages de `formatPrix()` (overlay desktop, inline mobile) — propriété typographique de données, indépendante du choix serif (§ Design System : prix/données bénéficient de chiffres tabulaires).
- **`font-serif` des prix explicitement conservé, pas retiré** : vérifié comme un précédent réel déjà établi (`BienHero.tsx`, `AcquereurHero.tsx` traitent aussi leurs valeurs numériques « porteuses » — prix, budget — en serif), donc pas une incohérence du DS mais une convention distincte de `StatTile` (données comparatives, Inter + tabular-nums). H1 `font-serif`/taille/`leading` intact, renvoyé comme prévu aux Lots 8A/8B.
- **`text-white` du prix en overlay sur photo explicitement conservé**, non converti en `text-text-inverse` : décision actée que le scrim média (`rgba(3,10,28,0.6)`, `#030A1C`) est un contexte fonctionnellement distinct de la surface inverse de marque (navy) — `text-text-inverse` est défini pour le chrome applicatif, pas pour un aplat photographique quelconque. Aucun token `text-on-media` créé à ce stade ; si un besoin réapparaît, il devra rester atomique sur tous les consommateurs de scrim média (`PropertyVisual`, `PhotoPrincipale`).
- Eyebrow `text-champagne`, `Badge` (variants `default`/`accent`/`success`, non renommés), `ChampRecherche`/`Pagination` (ADR-048 : GET natif, `q`/`archives`/`page` préservés, pagination server-side) et `PropertyVisual`/`PhotoPrincipale` (gradient navy, scrim `#030A1C`, marqueur champagne) laissés strictement intacts.
- Fiche Bien (`app/biens/[id]/**`) explicitement hors périmètre. Dette E2E déjà connue avant ce lot (`coeur.smoke.spec.ts` échoue sur le titre de la fiche `/biens/[id]`) confirmée sans aucun rapport avec la liste : ce smoke ne visite jamais la route `/biens` — la liste Biens n'a donc aucune couverture E2E, connue ou nouvelle, et n'a pas été impactée.
- Tests : `biens/page.test.tsx` (6/6), `ChampRecherche.test.tsx` (3/3), `Pagination.test.tsx` (5/5) verts sans modification ; suite Vitest complète 182/182 fichiers, 1454/1454 tests ; `tsc --noEmit` et `next build` propres.
- Validation visuelle desktop (1440px, vue actifs + vue archives) et mobile (390px) via script Playwright jetable (session réelle injectée, non conservé) : prix lisibles et alignés (`tabular-nums`), aucune régression de contraste sur le prix en overlay, aucune anomalie constatée.

**Correction (audit Lot 8A)** : l'affirmation ci-dessus selon laquelle le `font-serif` des prix ne serait « pas une incohérence du DS » est erronée — `DESIGN-SYSTEM-V1.md` § 3 précise explicitement que « Prix, budgets, métriques et données comparatives restent en Inter avec chiffres tabulaires lorsque pertinent ». Cette ligne n'avait pas été retrouvée lors de l'audit Lot 7. Le point est donc réouvert et tranché en Lot 8B (§ J.15, décision 8B — data/prix) : les 5 usages serif sur des valeurs numériques devront sortir vers Inter + `tabular-nums`.

### J.15 ✅ Lot 8A appliqué — préparation Cormorant Garamond (zéro activation visuelle)

Chargement technique de Cormorant Garamond via `next/font/google`, strictement sans bascule visuelle — conforme à la scission 8A/8B (§ A.2) :

- `layout.tsx` : ajout de `const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], display: "swap", weight: ["600"], style: ["normal"] })`, variable ajoutée à la liste de classes de `<html>`. `Inter`/`Fraunces` non modifiés (ni poids, ni style, ni variable).
- Poids 600/normal uniquement, choix vérifié par audit exhaustif : les 19 usages `font-serif` réels du dépôt consomment tous `font-semibold` (600), aucun italique — aucune variante hypothétique préchargée.
- `globals.css` **non modifié** : `--font-serif: var(--font-fraunces)` intact, vérifié à la fois dans la source et dans le CSS compilé (`.font-serif{font-family:var(--font-fraunces)}`, byte-identique avant/après).
- **0 consommateur** de `font-cormorant`/`var(--font-cormorant)` en dehors de `layout.tsx` (recherche exhaustive confirmée) — aucun `h1`, prix, `Card`, `EmptyState`, `BrandMark` ou écran modifié.
- CSS compilé confirme : `@font-face` Cormorant Garamond présents (weight 600, style normal uniquement), `--font-cormorant` exposée avec fallback automatique (`"Cormorant Garamond Fallback"`), aucun utilitaire `.font-cormorant` généré (rien ne le consomme côté Tailwind).
- Performance : aucun `<link rel="preload" as="font">` constaté sur une page ne consommant pas Cormorant (`_not-found.html`) — le mécanisme Turbopack ne précharge pas une police non utilisée par un élément rendu ; le seul coût est quelques octets de `@font-face` supplémentaires dans le CSS global déjà partagé par toutes les routes.
- Validation visuelle « zéro diff » : `/connexion` (témoin sans aucune serif), `/` et `/biens` (desktop 1440px + mobile 390px, session réelle injectée) via script Playwright jetable non conservé — H1 Aujourd'hui/Biens et prix Biens visuellement identiques aux captures des Lots 6/7, aucune différence constatée.
- Tests : suite Vitest complète 182/182 fichiers, 1454/1454 tests, sans modification ni ajout ; `tsc --noEmit` et `next build` propres (le build valide la disponibilité réelle du poids/style demandé auprès de Google Fonts). Aucun test structurel dédié créé (TypeScript + build + inspection CSS jugés suffisants — un test lisant `layout.tsx` en source aurait été une reproduction fragile sans valeur ajoutée).
- **Fraunces poids 500 et style italique identifiés comme poids mort réel** (aucun des 19 usages ne les consomme) mais **volontairement conservés tels quels** — leur retrait n'appartient pas à ce lot, seulement à la bascule atomique du Lot 8B.
- **Décisions actées pour le Lot 8B, non appliquées ici :**
  - *Data/prix* : les 5 usages serif sur valeurs numériques (prix overlay + mobile liste Biens, prix Fiche Bien hero, budget Fiche Acquéreur hero, estimation Fiche Prospect vendeur hero) devront sortir de `font-serif` vers Inter + `tabular-nums`, conformément à `DESIGN-SYSTEM-V1.md` § 3. Aucune exception « chiffre porteur » ne sera créée dans le Design System — la cohérence data prime sur le précédent historique Fraunces.
  - *Petits titres de carte* : `ProspectVendeurBienCree.tsx` (titre de carte succès, 17/18px) et `ProspectVendeurProchaineEtape.tsx` (titre d'étape, 18/19px) sont classés UI fonctionnelle, pas moment de marque → Inter en Lot 8B, pas Cormorant.
  - Inventaire complet des 19 usages `font-serif`/15 fichiers, classification A-F et tableau des H1 (§ audit Lot 8A) conservés pour construire le diff 8B sans refaire la cartographie.
- `BrandMark.tsx` confirmé hors sujet : n'utilise aucune police serif (mot-symbole en Inter, monogramme SVG géométrique pur) — aucun impact, aucune décision requise avant l'arrivée de l'asset logo maître.

### J.16 ✅ Lot 8B appliqué — activation Cormorant Garamond, bascule atomique

Bascule réalisée en un seul commit, sans état intermédiaire dégradé : `--font-serif` repointé vers Cormorant, Fraunces entièrement retirée, tous les mauvais usages serif nettoyés dans le même diff.

- `globals.css` : `--font-serif: var(--font-fraunces)` → `--font-serif: var(--font-cormorant)`. Aucune autre variable du `@theme` touchée.
- `layout.tsx` : `Fraunces` entièrement supprimée (import, `const fraunces`, `.variable` sur `<html>`) — confirmé sans consommateur résiduel avant suppression. `Inter`/`Cormorant_Garamond` conservés dans leur configuration exacte (600/normal/latin, aucun poids ajouté).
- **5 consommateurs `font-serif` finaux, exhaustivement vérifiés** : H1 `app/page.tsx` (Aujourd'hui), H1 `app/biens/page.tsx` (Biens/archivés), titre `BienHero.tsx` (adresse), nom `AcquereurHero.tsx`, nom `ProspectVendeurHero.tsx` — classes de taille/leading/weight strictement inchangées sur les 5.
- **13 usages repassés en Inter** (simple retrait de `font-serif`, aucun `font-sans` ajouté — héritage du body) : H1 `Clients` (rejoint Prospects vendeurs/Dashboard, même palier visuel 22/28), H1 `Fiscal`/`Automatisations`/`Pack Notaire`/`Ajouter un bien`/`Nouvel acquéreur` (20/24, fonctionnels), H1 `Gérer les photos` (28/34 conservé avec son eyebrow champagne — classé fonctionnel malgré le gabarit visuel partagé avec Aujourd'hui/Biens, décision humaine tranchée en GO), 2 petits titres `ProspectVendeurBienCree`/`ProspectVendeurProchaineEtape`.
- **5 données numériques repassées en Inter + `tabular-nums`** (conformément à `DESIGN-SYSTEM-V1.md` § 3) : prix overlay + mobile liste Biens (`tabular-nums` déjà présent depuis le Lot 7), prix `BienHero`, budget `AcquereurHero`, estimation `ProspectVendeurHero` (`tabular-nums` ajouté sur ces 3 derniers). Le prix en overlay sur photo conserve `text-white` (scrim média, toujours distinct de la surface inverse de marque).
- Vérifications post-application : recherche exhaustive confirme exactement 5 consommateurs JSX `font-serif` et 0 occurrence active de `Fraunces`/`--font-fraunces` dans le code. CSS compilé confirme `.font-serif{font-family:var(--font-cormorant)}`, `--font-cormorant` exposée avec fallback, aucun `@font-face` Fraunces résiduel, Cormorant toujours limitée à 600/normal.
- Tests : suite Vitest complète 182/182 fichiers, 1454/1454 tests, sans aucune modification (aucun test n'asserte de classe de police) ; `tsc --noEmit` et `next build` propres.
- Validation visuelle desktop (1440px) et mobile (390px) via scripts Playwright jetables non conservés : Aujourd'hui, Biens, Fiche Bien (hero), Clients, Fiche Acquéreur (hero), Fiscal, Automatisations, formulaires Bien/Acquéreur, page Photos, Pack Notaire, `/connexion` (témoin Inter, inchangée) — tous conformes à l'intention, aucune anomalie de layout/wrapping/densité constatée.
- **Test nom long** (`AcquereurHero`, remplacement DOM temporaire par « Jean-Baptiste de Montmorency-Villiers ») : passe sur une seule ligne en desktop, passe proprement sur deux lignes en mobile sans débordement horizontal ni collision avec l'avatar/badge — aucun `truncate` nécessaire dans l'immédiat, point à surveiller si des noms réels plus longs apparaissent.
- `e2e/coeur.smoke.spec.ts` exécuté via la commande officielle : échoue exactement au même endroit et sur la même assertion qu'avant ce lot (texte « Bien smoke » introuvable sur la fiche Bien, qui affiche l'adresse) — dette déjà connue, strictement inchangée, confirmée sans lien avec ce lot (seule la police du titre a changé, jamais son contenu).
- Aucune couleur, aucun spacing, aucun radius, aucune logique métier modifiée — diff strictement typographique.

### J.17 ⚠ Lot 9 arbitré — Tabs/Table/Skeleton différées faute de consommateurs suffisants

**Statut : CLOS PAR ARBITRAGE / NON-CRÉATION PRÉMATURÉE.** L'audit a été mené intégralement (cartographie exhaustive des trois sujets) mais a abouti à la décision consciente de ne créer aucune des trois primitives dans ce lot. Aucun fichier runtime modifié, uniquement cette entrée de documentation.

**Principe architectural enregistré, à appliquer à tous les lots suivants** : *une primitive du Design System n'est créée que lorsqu'un usage réel permet d'en valider l'API et la sémantique. La roadmap nomme des besoins à examiner, pas des composants à créer obligatoirement.*

**TABS.** Un seul système existe dans tout le dépôt : `BienTabs.tsx` (`role="tablist"`/`role="tab"`/`aria-selected`, liste d'onglets dynamique, `useState<Tab>` local, `overflow-x-auto` avec affordances de scroll gauche/droite et `scrollIntoView` de l'onglet actif — comportement non trivial déjà fonctionnel). Décision : extraction d'une primitive `Tabs` **différée au Lot 10**, à créer et adopter **atomiquement** avec `BienTabs.tsx` dans le même chantier — jamais la barre d'onglets seule avant de traiter réellement les panneaux. Dettes actuelles de `BienTabs.tsx` à traiter par cette même occasion : aucun `role="tabpanel"`, aucun `aria-controls`/`aria-labelledby`, aucune navigation clavier ArrowLeft/ArrowRight/Home/End (focus natif seulement). `BienTabs.tsx` reste strictement intact dans ce lot — aucune modification, pas même de tokens, d'aria ou de commentaires. `documents-adr049.smoke.spec.ts` (clics répétés sur les onglets Documents/Compromis) constitue la couverture E2E réelle actuelle des interactions Tabs — `coeur.smoke.spec.ts` prévoit un clic équivalent (ligne 83) mais ne l'atteint jamais à cause de la dette Fiche Bien déjà connue, sans lien avec ce lot.

**TABLE.** Une seule table HTML native existe dans tout le dépôt : `app/dashboard/page.tsx` (`VentilationAnnuelleTable`, 12 lignes mensuelles fixes, 4 colonnes, aucun tri/filtre/action/badge/lien, déjà enveloppée dans `overflow-x-auto`). Un unique consommateur aussi simple ne justifie pas une primitive : le wrapper `<table className="w-full text-[13px] ...">` envisagé par l'audit n'aurait fait qu'ajouter un niveau d'indirection et figer une convention (`text-[13px]`) sans second usage pour la valider, sans supprimer de duplication réelle. `dashboard/page.tsx` reste strictement intact dans ce lot. Dettes déjà identifiées, réservées au futur chantier Dashboard (propagation § F.5, pas ce lot) : alias historiques (`text-text-1/2/3` → `text-text-primary/secondary/muted`, `border-border` → `border-border-subtle`), `<th>` sans `scope="col"`, absence de `tabular-nums` sur les 3 colonnes monétaires empilées sur 12 lignes. Ce futur chantier devra d'abord améliorer la table native ; une primitive `Table` ne sera créée que si un second usage compatible apparaît réellement ou si l'extraction démontre une valeur.

**SKELETON.** Recherche exhaustive : 0 composant Skeleton, 0 `animate-pulse`, 0 fichier `loading.tsx`, 0 `Suspense` réel, 0 état `isLoading` pertinent dans toute l'application — aucun point d'insertion architectural n'existe (toutes les pages sont des Server Components à chargement synchrone). Créer `Skeleton.tsx` aujourd'hui serait une abstraction spéculative sans consommateur. Décision ferme : non créée. Elle le sera au premier besoin réel de chargement asynchrone, sa forme dérivée du contexte de ce moment-là.

**MOTION (dette transverse, hors périmètre).** L'unique `animate-spin` du produit (`Button.tsx`, spinner de chargement) n'a aucune gestion `prefers-reduced-motion`/`motion-safe`/`motion-reduce` — dette réelle mais indépendante de ce lot, documentée sans correction. `Button.tsx` reste intact.

### J.18 ✅ Lot 10A appliqué — extraction de la barre d'onglets accessible

Premier sous-lot de la migration progressive de la Fiche Bien (§ J.5) : « extraire la barre d'onglets de `BienTabs` dans une primitive `ui/Tabs` réellement consommée et compléter clavier + ARIA, sans modifier le contenu métier ou le design des huit panneaux. » Conforme à la décision Lot 9 (§ J.17) : la primitive n'existe qu'avec un vrai consommateur, adopté dans le même commit.

- `apps/web/src/components/ui/Tabs.tsx` (nouveau, `"use client"`) : API générique `Tabs<T extends string>({ tabs, active, onChange, idBase })`, deux fonctions pures exportées `getTabId`/`getTabPanelId` (seul point de vérité de la convention d'ID, utilisées à la fois par `Tabs` et par `BienTabs`). `active` reste entièrement contrôlé par l'appelant (`BienTabs` garde son `useState<Tab>("contexte")` inchangé) — aucun Context, aucun reducer, aucune dépendance nouvelle.
- **Activation manuelle** (WAI-ARIA APG) : état interne `focusedId` distinct de `active`, initialisé sur `active` et resynchronisé à chaque changement de `active` (avec repli déterministe si l'onglet focalisé disparaît d'une liste dynamique — vers `active` s'il existe encore, sinon le premier onglet). `tabIndex` (roving) suit `focusedId` ; `aria-selected` suit uniquement `active`. `ArrowLeft`/`ArrowRight`/`Home`/`End` déplacent uniquement le focus (avec bouclage début/fin) ; `Enter`/`Space` ne sont **pas** interceptés — le `<button type="button">` natif déclenche déjà `onClick` nativement, qui appelle `onChange`.
- **Panneaux** : les 8 blocs `{active === "x" && (...)}` de `BienTabs.tsx` sont chacun enveloppés dans un `<div role="tabpanel" id={getTabPanelId(...)} aria-labelledby={getTabId(...)} hidden={active !== "x"}>` toujours présent dans le DOM — la relation `aria-controls`/`id` reste donc valide pour tous les onglets à tout moment, tandis que le contenu métier (formulaires, listes) réellement lourd de chaque panneau **n'est monté par React que pour l'onglet actif**, exactement comme avant (vérifié : 0 enfant DOM pour un panneau inactif, contenu réel dès activation). Aucun texte, champ, Card, Button, SectionTitle, Badge, token ou action métier modifié à l'intérieur des 8 panneaux — diff strictement additif sur leur wrapper.
- **Tokens de la barre**, nés directement sémantiques : inactif `border-transparent text-text-muted hover:text-text-secondary`, actif `border-action-primary text-action-primary`, conteneur `border-border-subtle`. Comportement de scroll (refs, dégradés gauche/droite, `overflow-x-auto`, `scrollbar-none`, `scroll-smooth`) repris à l'identique de l'ancien `BienTabs.tsx`, plus un `scrollIntoView` explicite ajouté sur l'onglet focalisé au clavier (le défilement natif de `focus()` seul s'est révélé insuffisant sur mobile 390px, constaté par test réel).
- **Focus — exception locale documentée** : `focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring`. Un test Playwright réel a démontré qu'un offset positif est rogné verticalement par le conteneur `overflow-x-auto` (la règle CSS de calcul d'overflow force l'axe Y en mode non-visible dès que l'axe X est `auto`) ; l'offset négatif reste complet et bien contrasté, vérifié sur onglet actif, onglet inactif, desktop 1440px et mobile 390px. Convention DS globale (offset positif) non modifiée — exception isolée à ce seul composant.
- **Validation** : `BienTabs.test.tsx` 5/5 verts sans modification ; suite Vitest complète 182/182 fichiers, 1454/1454 tests ; `tsc --noEmit` et `next build` propres ; `documents-adr049.smoke.spec.ts` (clics réels sur les onglets Documents/Compromis) vert ; `coeur.smoke.spec.ts` échoue exactement à l'identique de la dette déjà connue (titre), sans lien avec ce lot. Script Playwright jetable non conservé : invariant roving tabindex vérifié à chaque étape (exactement un onglet à `tabIndex=0`), relations `aria-controls`→panneau et `aria-labelledby`→onglet vérifiées pour les 6 onglets réels du bien de démonstration, bouclage clavier (dernier→premier, premier→dernier) vérifié, activation Enter et Space vérifiée, contenu lourd non monté à l'état inactif prouvé par comptage direct des nœuds DOM (0 vs 31 enfants).
- **Aucun** des 55 champs recensés (§ audit Lot 10), aucun `OffreFormulaire`/`CompromisFormulaire`, aucun autre composant de la Fiche Bien (`BienHero`, `BienGaleriePhotos`, `BienStatutAction`, `BienVendeurMandat`, `BienAcquereursCompatibles`, `page.tsx`) n'a été touché — strictement réservé aux sous-lots 10B et suivants (§ J.5, feuille de route auditée).

### J.19 ✅ Lot 10B appliqué — migration du panel Tâches (tokens uniquement)

Deuxième sous-lot de la migration progressive de la Fiche Bien (§ J.5), strictement local au panel Tâches de `BienTabs.tsx` (lignes ~1375-1440, contenu du `tabpanel` posé au Lot 10A — le wrapper ARIA lui-même non touché).

- **10 substitutions de classes**, toutes des alias byte-identiques déjà vérifiés dans `globals.css` (aucune migration de token n'a été inventée) : `divide-border`→`divide-border-subtle`, `bg-border`→`bg-border-subtle`, `border-border-md`→`border-border-default` (×2, case statique et case interactive), `text-text-1`→`text-text-primary`, `text-text-3`→`text-text-muted` (×5 : état vide, contexte, échéance, provenance, « Annuler »), `text-accent`/`hover:text-accent-hover`→`text-action-primary`/`hover:text-action-primary-hover`, `hover:border-accent`→`hover:border-action-primary`, `hover:bg-accent-light`→`hover:bg-surface-subtle` (destination déjà validée au Lot 6 sur le cas identique de `TacheItem.tsx`), `hover:text-danger`→`hover:text-status-danger`.
- **Décision humaine actée : les deux éléments interactifs restent natifs, non convertis en `Button`.** La case 16×16px « Marquer comme terminée » est une affordance de case à cocher, pas un bouton — `Button` (même `sm`) imposerait un padding et une densité incompatibles avec cette métaphore, déjà établie à l'identique dans `TacheItem.tsx` (jamais convertie non plus). L'action « Annuler » est un texte inline 11px sans bordure ni fond — `Button` n'a aujourd'hui aucun variant (`sm` minimum, `text-[12px] px-2.5 py-1.5`) capable de la reproduire sans changer sa densité ; le Design System prévoit un variant `link` « si nécessaire » (`DESIGN-SYSTEM-V1.md` § Button) mais il n'est pas implémenté — dette transverse distincte, non traitée ici. `Button.tsx` n'a pas été modifié pour créer un variant sur mesure.
- **Logique métier strictement inchangée** : `terminerTacheAction`/`annulerTacheAction`, leurs champs cachés (`id`, `redirectTo`) et leurs valeurs, `deriverStatutTache`, `deriverCibleTache`, la condition et le texte de la provenance automatique (`labelRegleAutomatisation`), l'ordre des tâches — rien de tout cela n'a été touché, seules les couleurs migrent.
- **`TacheItem.tsx` non touché** : confirmé sans consommateur dans `BienTabs.tsx` (implémentation locale indépendante, comportement différent — case grisée statique, action Annuler absente de `TacheItem`) ; ses 3 consommateurs réels (Aujourd'hui, Fiche Acquéreur, Prospects vendeurs) restent hors périmètre.
- **Aucune primitive introduite** : pas de `Card` (le conteneur est une liste `divide-y`, pas une collection de cartes), pas de `SectionTitle` (aucun titre de section dans ce panel), pas d'`EmptyState` (message compact volontairement préservé), `Badge` non touché (aucun badge dans ce panel).
- **Aucune extraction** : migration inline, `BienTachesTab.tsx` non créé — ~66 lignes sans bénéfice structurel démontré.
- Validation : `BienTabs.test.tsx` 5/5 sans modification (ce panel n'est de toute façon jamais exercé par `renderToStaticMarkup`, `active` restant sur `"contexte"` dans tous les fixtures) ; suite Vitest complète 182/182 fichiers, 1454/1454 tests ; `tsc --noEmit` et `next build` propres. Aucun E2E existant ne couvre ce panel (recherche exhaustive confirmée), aucun nouveau créé. Validation visuelle jetable (`bien-001`, 3 tâches réelles, aucune mutation) : rendu desktop 1440px identique en tout point au diff (aucun changement de densité, tokens byte-identiques) ; les classes structurelles/responsive n'ayant subi aucune modification, la conformité à 768px/390px est garantie par construction. Hovers des trois éléments interactifs vérifiés sans déclencher de submit. **Limite documentée** : les 3 tâches du bien de démonstration n'ont pas d'origine automatique — la ligne de provenance n'a pas pu être observée visuellement, sa préservation est garantie par lecture directe du diff (condition et texte inchangés, seule la couleur migre).
- **Dette hors périmètre** : absence d'un variant `Button` compact/`link` adapté aux actions texte discrètes (affecte potentiellement d'autres futurs sous-lots, ex. 10D/10E/10F/10G) ; duplication comportementale entre ce panel et `TacheItem.tsx`, jamais unifiée.

### J.7 Note — scission du lot typographique

Le lot de recalage serif, initialement prévu comme une PR unique (« F.4b »), est scindé en deux lots étanches (8A/8B) pour respecter la contrainte de § A.2 : ne jamais déployer un état visuel intermédiaire connu comme dégradé. Voir § A.2, § F.4 et § I pour le détail.

---

## Annexe — correspondance des lettres de section

Ce document reprend la structure originale du plan (§ A à § J) sans renumérotation, les décisions complémentaires ayant été intégrées directement dans les sections qu'elles concernent plutôt qu'ajoutées en appendice séparé.
