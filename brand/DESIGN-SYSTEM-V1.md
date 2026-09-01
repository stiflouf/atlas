# DOMIORA — Design System UI V1

**Source de vérité — Design System UI V1**

Consolidé le 29 août 2026 à partir de la planche validée « DOMIORA - Design System V1 » et des arbitrages d'accessibilité ultérieurs.

Ce document complète `brand/FONDATIONS.md`. En cas de conflit sur la marque, les fondations priment. En cas de conflit sur l'implémentation progressive, `brand/IMPLEMENTATION-DS-V1.md` précise le séquencement.

---

## 1. Principes

DOMIORA est un outil métier avant d'être un objet décoratif.

Ordre de priorité :

1. lisibilité ;
2. rapidité de compréhension ;
3. efficacité opérationnelle ;
4. hiérarchie claire ;
5. cohérence ;
6. élégance.

L'interface doit être premium parce qu'elle est maîtrisée, calme et précise, jamais parce qu'elle accumule l'or, les effets ou les grandes serif.

---

## 2. Couleurs

### 2.1 Encre / navy

| Token | Valeur | Usage |
|---|---|---|
| `ink-900` | `#02152B` | navy canonique, sidebar, action primaire, fond inverse |
| `ink-800` | `#0B2440` | hover primaire |
| `ink-700` | `#17354F` | pressed, focus ring |
| `ink-600` | `#2E4A63` | bordure forte |

`#02152B` est le bleu nuit canonique DOMIORA.

### 2.2 Surfaces

| Sémantique | Valeur | Usage |
|---|---|---|
| `bg-page` | `#F6F2EA` | fond de page |
| `bg-surface` | `#FFFCF7` | cartes et panneaux |
| `bg-surface-subtle` | `#F0EBE0` | rails, en-têtes, surfaces secondaires |
| `bg-data` | `#FFFFFF` | corps de tableau, champs, intérieur de modale |
| `bg-inverse` | `#02152B` | zones inversées |

Règle : **le blanc pur est le papier de la donnée ; l'ivoire est le mobilier autour.**

### 2.3 Texte

| Token | Valeur |
|---|---|
| `text-primary` | `#122038` |
| `text-secondary` | `#5A5D70` |
| `text-muted` | `#696B7B` |
| `text-disabled` | `#8B8D9E` |
| `text-inverse` | `#FFFCF7` |

`text-muted` a été corrigé de `#6E7080` vers `#696B7B` afin de respecter WCAG AA sur `bg-page #F6F2EA`.

`text-disabled` n'est pas destiné au texte courant.

### 2.4 Bordures et focus

| Token | Valeur |
|---|---|
| `border-subtle` | `#E8E0CF` |
| `border-default` | `#D9CEB6` |
| `border-strong` | `#2E4A63` |
| `focus-ring` | `#17354F` |

Focus : 2 px, offset 2 px.

### 2.5 Actions

| Token | Valeur |
|---|---|
| `action-primary` | `#02152B` |
| `action-primary-hover` | `#0B2440` |
| `action-primary-active` | `#17354F` |

Le bouton primaire n'est pas doré.

### 2.6 Statuts

| Famille | Foreground | Background subtil | Border |
|---|---|---|---|
| success | `#3A6B4F` | `#E8F0EA` | `#D5E2D9` |
| warning | `#8A5E22` | `#F5EAD4` | `#E6D7B8` |
| danger | `#AE4029` | `#F7E6DF` | `#ECD3C9` |
| info | `#2E5C7A` | `#E6EEF3` | `#D2E0E8` |

Le warning a été assombri de `#92692C` vers `#8A5E22` pour respecter AA. Sa proximité éventuelle avec le futur or DOMIORA sera réévaluée lorsque l'asset maître sera disponible.

### 2.7 Or DOMIORA

Réservations :

- `--color-brand-gold`
- `--color-brand-gold-subtle`

Statut : `PENDING_MASTER_LOGO_ASSET`.

Ne pas attribuer de valeur depuis la vignette.

`#C59A5B` et `#DCB877` sont historiques / exploratoires, non canoniques.

### 2.8 Scrims média

Les overlays très sombres utilisés sur photographie sont des couleurs **fonctionnelles de lisibilité**, pas des navy de marque.

La valeur historique `#030A1C` peut rester inchangée tant qu'un token `media-scrim` dédié n'est pas introduit de manière cohérente sur tous ses consommateurs.

Ne pas la remplacer isolément par un token de marque.

---

## 3. Typographie

### Polices

- Expression de marque : **Cormorant Garamond**
- Produit / interface / données : **Inter**
- Répartition cible dans l'application : environ **10 % Cormorant / 90 % Inter**

### Échelle

| Usage | Police / taille |
|---|---|
| Display marketing | Cormorant Garamond 52 px / 1.05 / 600 |
| H1 produit | Cormorant Garamond 34 px / 1.1 / 600 |
| H2 | Inter 20 px / 1.3 / 600 |
| H3 | Inter 16 px / 1.4 / 600 |
| Body | Inter 14 px / 1.6 |
| Label | Inter 12 px / 500 |
| Data large | Inter 24 px / 600 / tabular nums |
| Data | Inter 14 px / 500 / tabular nums |

Prix, budgets, métriques et données comparatives restent en Inter avec chiffres tabulaires lorsque pertinent.

---

## 4. Espacement

Base 4 px.

Échelle recommandée :

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`

Ne pas redéfinir l'échelle Tailwind globale si elle correspond déjà à cette base.

---

## 5. Rayons

| DS | px | Tailwind |
|---|---:|---|
| sm | 6 | `rounded-md` |
| md | 8 | `rounded-lg` |
| lg | 12 | `rounded-xl` |
| xl | 16 | `rounded-2xl` |
| pill | ∞ | `rounded-full` |

Usage :
- badge : 6 ;
- bouton / champ : 8 ;
- carte : 12 ;
- modale : 16 ;
- pill : réservé aux chips de filtre et avatars.

Ne jamais redéfinir l'échelle Tailwind globale pour faire coïncider les noms.

---

## 6. Ombres

| Niveau | Valeur |
|---|---|
| surface | `0 1px 2px rgba(2,21,43,0.05)` |
| floating | `0 4px 16px -4px rgba(2,21,43,0.12)` |
| modal | `0 24px 48px -16px rgba(2,21,43,0.28)` |

Les ombres restent secondaires par rapport aux fonds, bordures et espacements.

---

## 7. Layout et responsive

Breakpoints : ceux de Tailwind.

Références :
- 640 ;
- 768 ;
- 1024 ;
- 1280.

Règles :
- lignes éditoriales plafonnées à environ 72 caractères ;
- formulaires jamais plus larges que 640 px lorsque pertinent ;
- grands écrans exploités sans étirer inutilement textes et formulaires ;
- comportements mobile définis composant par composant.

---

## 8. Iconographie

Bibliothèque : `lucide-react`.

Règles :
- trait standard : 1.8 ;
- tailles : 14 / 16 / 20 / 24 ;
- aucune bibliothèque propriétaire sans justification.

---

## 9. Motion

| Usage | Durée |
|---|---:|
| micro-interaction | 120 ms |
| ouverture | 180 ms |
| fermeture | 140 ms |
| déplacement | 220 ms |

Courbe unique à documenter dans les tokens d'implémentation.

Animations fonctionnelles uniquement.

---

## 10. Composants

### Button

Variantes :
- primary ;
- secondary ;
- ghost ;
- destructive ;
- link si nécessaire.

États :
- default ;
- hover ;
- active ;
- focus ;
- disabled ;
- loading.

Primary = navy, jamais or par défaut.

### Input / Textarea / Select

Rayon 8 px. `bg-data`. Bordure default. Focus via `focus-ring`.

États :
- default ;
- hover ;
- focus ;
- filled ;
- error ;
- disabled ;
- readonly.

### Card

Rayon 12 px.

Usages :
- surface simple ;
- actionable ;
- metric ;
- highlighted seulement si nécessaire.

Éviter les cartes imbriquées inutilement.

### Table

Densité confortable.
- header : surface-subtle ;
- body : bg-data ;
- hover, selected, sortable, actions et responsive à formaliser dans la primitive.

### Badge

Rayon 6 px.
Séparer les registres métier : statut, catégorie, système, priorité.
Ne pas utiliser l'or comme badge générique.

### Tabs

Navigation locale simple, états active/hover/focus et overflow mobile.

### Dialog / Modal

Rayon 16 px. Fond `bg-data`. Hiérarchie header/body/footer claire.

### Toast / Notification

Familles success / info / warning / danger.

Un toast d'erreur ne disparaît pas automatiquement lorsqu'une action corrective est requise ; il porte l'action permettant de réparer.

### EmptyState

Doit répondre :
1. qu'est-ce qui manque ?
2. pourquoi ?
3. que faire ensuite ?

Pas de grandes illustrations décoratives.

### Loading

Spinner, skeleton, loading inline et loading d'action sobres.

---

## 11. Intelligence DOMIORA

Principe : **« Une mise en lumière, pas un assistant. »**

L'intelligence DOMIORA doit apparaître comme :
- aide ;
- suggestion ;
- opportunité ;
- explication ;
- action recommandée ;
- résultat à valider humainement.

Elle ne doit pas ressembler à :
- chatbot omniprésent ;
- magie ;
- univers violet / néon ;
- sparkles partout.

Aucun faux pictogramme de flamme ou de logo tant que l'asset maître n'est pas disponible.

---

## 12. Accessibilité

- WCAG AA pour le texte courant.
- Focus visible cohérent.
- Navigation clavier préservée.
- Ne jamais sacrifier le contraste à une intention « premium ».

Valeurs corrigées :
- `text-muted = #696B7B`
- `warning foreground = #8A5E22`

---

## 13. Logo

Le produit affiche une **référence raster** du logo validé
(`apps/web/public/brand/domiora-mark-flamme-discrete.png`), telle quelle : aucun retrace, aucun
recadrage, aucune recoloration. Le master vectoriel reste à fournir.

Aucun substitut visuel ne doit être dessiné, et les tokens or restent en attente : leurs valeurs
viendront du vectoriel, jamais d'un échantillonnage de ce PNG (voir § 2.7,
`PENDING_MASTER_LOGO_ASSET`, inchangé).

---

## 14. Points encore ouverts

- valeurs or officielles ;
- éventuel recalage du warning après extraction de l'or ;
- introduction future d'un token sémantique `media-scrim` pour remplacer `#030A1C` de manière cohérente sur tous les consommateurs ;
- nomenclature primitive détaillée des neutres si elle devient utile à l'implémentation.

Ne pas inventer ces points au fil d'un écran.
