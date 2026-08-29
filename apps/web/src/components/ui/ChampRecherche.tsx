import { Search } from "lucide-react";
import Button from "./Button";
import Input from "./Input";

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
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" strokeWidth={1.8} />
        <Input type="text" name="q" defaultValue={q ?? ""} placeholder={placeholder} className="pl-9 pr-3" />
      </div>
      {champsCaches &&
        Object.entries(champsCaches).map(([nom, valeur]) => <input key={nom} type="hidden" name={nom} value={valeur} />)}
      <Button type="submit" variant="primary" size="md">
        Rechercher
      </Button>
      {q && (
        <a href={hrefEffacer} className="text-[13px] text-text-2 hover:text-text-1 transition-colors shrink-0">
          Effacer
        </a>
      )}
    </form>
  );
}
