// Habillage commun aux champs de formulaire natifs (Input, Textarea, Select) — DESIGN-SYSTEM-V1.md
// § 2.2 (bg-data), § 2.4 (border-default, focus-ring) et « Composants » (rayon 8 px). Un seul point
// de vérité pour éviter trois chaînes divergentes, sans dépendance supplémentaire (concaténation
// simple, comme `classesBouton` dans Button.tsx).
export const FIELD_BASE_CLASSES =
  "w-full border border-border-default rounded-lg px-3 py-2 text-[14px] text-text-primary bg-data focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring";
