import { Search } from "lucide-react";

// ADR-048 — formulaire GET natif (jamais de JS obligatoire) : partageable par URL, fonctionne à
// l'identique avec ou sans JavaScript, cohérent avec le reste du produit (aucune dépendance
// client-side lourde pour une simple recherche). champsCaches préserve les paramètres déjà actifs
// (archives/vue) qui ne sont pas des champs de ce formulaire — sans eux, une recherche depuis la
// vue "archives" perdrait silencieusement ce filtre.
type Props = {
  action: string;
  q?: string;
  placeholder: string;
  champsCaches?: Record<string, string>;
  hrefEffacer: string;
};

export default function ChampRecherche({ action, q, placeholder, champsCaches, hrefEffacer }: Props) {
  return (
    <form method="GET" action={action} className="flex items-center gap-2 mb-6">
      <div className="relative flex-1 max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" strokeWidth={1.8} />
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder={placeholder}
          className="w-full border border-[#e2e8f0] rounded-lg pl-9 pr-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
        />
      </div>
      {champsCaches &&
        Object.entries(champsCaches).map(([nom, valeur]) => <input key={nom} type="hidden" name={nom} value={valeur} />)}
      <button
        type="submit"
        className="text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg shrink-0"
      >
        Rechercher
      </button>
      {q && (
        <a href={hrefEffacer} className="text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors shrink-0">
          Effacer
        </a>
      )}
    </form>
  );
}
