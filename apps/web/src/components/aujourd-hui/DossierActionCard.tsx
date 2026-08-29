import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Card from "@/components/ui/Card";
import type { Bien } from "@/types/bien";

function labelCourt(bien: Bien): string {
  return bien.titre.split(" — ")[0] ?? bien.titre;
}

// Dossier à traiter — deux lignes hiérarchisées au lieu d'une phrase unique.
//
// Avant : « Titre — raison » dans un seul <p>, précédé d'une IconTile Building2 identique sur
// chaque ligne. L'icône répétée n'apportait aucune information (on sait qu'il s'agit d'un bien) et
// consommait la largeur qui manquait à la raison.
//
// Après : un rail champagne (marque, pas décor), le nom du bien en poids fort, la raison en
// dessous en secondaire, un chevron d'affordance. Aucune donnée nouvelle : `bien` et `raison` sont
// les mêmes props, calculées au même endroit.
export default function DossierActionCard({ bien, raison }: { bien: Bien; raison: string }) {
  return (
    <Link href={`/biens/${bien.id}`}>
      <Card variant="interactive">
        <div className="flex items-center gap-3.5 p-3.5">
          <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-full bg-champagne" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-text-primary">{labelCourt(bien)}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-text-secondary">{raison}</p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-text-muted" />
        </div>
      </Card>
    </Link>
  );
}
