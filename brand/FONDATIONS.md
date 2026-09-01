# DOMIORA — Fondations de marque

**Source de vérité — Fondations de marque**

Enregistrée le 28 août 2026. Toute décision listée ici est verrouillée et ne se rouvre que sur demande explicite.

---

## 1. Logo maître

**« 5. FLAMME DISCRÈTE »** — lettre D dorée, flamme dorée à l'intérieur du D. Proportions, géométrie et positionnement validés en l'état.

Interdits, sans exception : redessiner, réinterpréter, simplifier, régénérer, modifier la flamme, modifier le D, modifier leurs proportions relatives, déplacer la flamme, ajouter un cœur, une fleur de lys, une croix ou tout autre symbole, recomposer le logo avec une police, l'approximer en CSS, en produire un SVG par lecture visuelle, en générer une variante par IA.

Le logo s'affiche **uniquement** depuis l'asset maître approuvé.

La symbolique n'a pas à être explicitée dans l'interface ni dans la communication commerciale.

### État actuel — référence raster en production, master vectoriel toujours manquant

Le produit affiche depuis le 1er septembre 2026 une **référence raster** du logo validé :
`apps/web/public/brand/domiora-mark-flamme-discrete.png` (PNG 1024 × 1024, symbole seul, sans titre
ni badge ni cadre, fond navy intégré à l'image — pas de couche alpha). Elle est issue de la vignette
finale validée et affichée telle quelle par `BrandMark`, sans retrace, sans recadrage et sans
recoloration.

**Ce n'est pas le master.** Le vectoriel d'origine reste à fournir : lui seul permettra un rendu net
à toute échelle, un fond réellement transparent, et la détermination des ors officiels. Aucune
valeur dorée ne doit être extraite du PNG.

---

## 2. Baseline

« Votre activité immobilière. En lumière. »

Figée. Deux lectures assumées : DOMIORA apporte visibilité et clarté sur l'activité ; et faire émerger, révéler, éclairer.

---

## 3. Direction de marque

DOMIORA est : lumineuse, élégante, intelligente, humaine, exigeante, professionnelle, premium sans ostentation.

DOMIORA n'est pas : une marque de luxe clinquante, une agence immobilière générique noir/or, une marque à clichés graphiques (marbre, clés, maisons, immeubles), une interface décorative au détriment de l'efficacité, une marque tech/IA froide et démonstrative.

---

## 4. Principe central — la lumière

L'or représente la lumière. Il s'emploie en **accent**, jamais en aplat envahissant :

- souligner un élément important ;
- signaler une opportunité ;
- matérialiser certaines manifestations de l'intelligence DOMIORA ;
- créer un détail premium ;
- accompagner le logo.

L'or n'est pas la couleur des boutons, ni des titres, ni des bordures par défaut.

---

## 5. Couleurs

| Rôle | Valeur | Statut |
|---|---|---|
| Bleu nuit profond | `#02152B` | Verrouillé en direction ; la valeur exacte peut bouger très légèrement au calage colorimétrique final |
| Or DOMIORA | — | **À déterminer depuis l'asset source**, jamais depuis une vignette |
| Ivoire | — | À définir dans le Design System |
| Blanc | — | À définir dans le Design System |
| Neutres | — | À définir dans le Design System |

Le logo maître possède un rendu doré à plusieurs nuances et reflets. Les tokens or seront construits en analysant ses vraies valeurs. **Le logo ne se recolore jamais pour coïncider avec un token UI** — c'est le token qui se cale sur le logo.

### Architecture visuelle

**Sur fond clair** : ivoire ou blanc dominant, textes bleu nuit / anthracite, touches d'or ponctuelles.

**Sur zones institutionnelles ou premium** : bleu nuit dominant, texte blanc ou ivoire, logo et détails dorés.

---

## 6. Typographie

| Usage | Police |
|---|---|
| Expression de marque, grands titres, pages marketing, accroches, moments de marque | **Cormorant Garamond** |
| Produit, interface, données, formulaires, tableaux, textes courants | **Inter** |

Répartition cible dans l'application : environ **90 % Inter / 10 % Cormorant Garamond**.

Cormorant Garamond ne doit jamais dégrader la lisibilité du CRM ni donner une apparence de maison de parfum.

---

## 7. Priorités UI

DOMIORA est d'abord un outil de travail pour des professionnels de l'immobilier.

1. Lisibilité
2. Rapidité de compréhension
3. Efficacité opérationnelle
4. Hiérarchie claire de l'information
5. Cohérence
6. Élégance

Le branding ne dégrade jamais cet ordre.

---

## 8. Contradictions relevées avec l'existant

### 8.1 — La serif du produit n'est pas la serif de marque

Le produit charge Fraunces alors que la fondation verrouille Cormorant Garamond. La bascule doit être traitée comme un chantier de recalage typographique, pas comme un remplacement aveugle.

### 8.2 — Bleu nuit

`#02152B` est désormais le bleu nuit canonique DOMIORA. Les anciens navy proches doivent être migrés progressivement lorsqu'ils portent le même rôle de marque.

### 8.3 — La sidebar affiche désormais le logo validé (référence raster)

Résolu le 1er septembre 2026 : le monogramme géométrique temporaire a été retiré de `BrandMark`, qui
affiche la référence raster ci-dessus. Le remplacement par le vectoriel, quand il sera fourni, ne
touchera que ce composant.

### 8.4 — Les planches d'exploration logo sont périmées

Les anciens monogrammes et explorations sont des archives uniquement. Ils ne doivent servir de référence pour aucun écran, composant ou export.

### 8.5 — Les anciennes maquettes

Leurs décisions de structure, hiérarchie et contenu peuvent rester valides ; leur habillage typographique et colorimétrique doit être aligné sur le Design System V1 au moment de l'implémentation.

### 8.6 — Aucun token or ne peut être écrit aujourd'hui

Les anciennes valeurs `#C59A5B` et `#DCB877` sont provisoires et non canoniques.

---

## 9. Design System UI V1

Le Design System V1 est documenté dans `brand/DESIGN-SYSTEM-V1.md`.

---

## 10. Dépendances restantes

Deux dépendances particulières subsistent :

- **master vectoriel du logo** (une référence raster tient lieu d'affichage en attendant) ;
- par conséquent, **tokens or officiels**.

Elles ne bloquent pas l'industrialisation du reste du Design System.
