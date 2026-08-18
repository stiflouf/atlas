import Link from "next/link";

// ADR-048 — pagination Précédent/Suivant simple, jamais un scroll infini ni un chargement
// incrémental : cohérent avec le reste du produit (liens classiques, partageables, prévisibles).
// `construireHref` reste la responsabilité de la page appelante — elle seule connaît les autres
// paramètres (q/archives/vue) à préserver d'une page à l'autre.
type Props = {
  page: number;
  totalPages: number;
  construireHref: (page: number) => string;
};

export default function Pagination({ page, totalPages, construireHref }: Props) {
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-between mt-6 pt-4 border-t border-border">
      {page > 1 ? (
        <Link
          href={construireHref(page - 1)}
          className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors"
        >
          ← Précédent
        </Link>
      ) : (
        <span />
      )}
      <span className="text-[13px] text-text-3">
        Page {page} sur {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          href={construireHref(page + 1)}
          className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors"
        >
          Suivant →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
