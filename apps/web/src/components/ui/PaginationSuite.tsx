import Link from "next/link";

// Pendant de `Pagination` pour les listes qui ne connaissent pas leur total (ADR-058 : `hasMore`
// plutôt qu'un `COUNT(*)` que personne ne lit). Même markup, mêmes classes, même responsabilité
// laissée à l'appelant pour `construireHref` — seule la condition d'affichage change.
type Props = {
  page: number;
  hasMore: boolean;
  construireHref: (page: number) => string;
};

export default function PaginationSuite({ page, hasMore, construireHref }: Props) {
  if (page <= 1 && !hasMore) return null;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between mt-6 pt-4 border-t border-border-subtle">
      {page > 1 ? (
        <Link
          href={construireHref(page - 1)}
          className="text-[13px] font-medium text-action-primary hover:text-action-primary-hover transition-colors"
        >
          ← Précédent
        </Link>
      ) : (
        <span />
      )}
      <span aria-current="page" className="text-[13px] text-text-muted">
        Page {page}
      </span>
      {hasMore ? (
        <Link
          href={construireHref(page + 1)}
          className="text-[13px] font-medium text-action-primary hover:text-action-primary-hover transition-colors"
        >
          Suivant →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
