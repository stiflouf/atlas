import Link from "next/link";
import { Building2 } from "lucide-react";
import Card from "@/components/ui/Card";
import IconTile from "@/components/ui/IconTile";
import type { Bien } from "@/types/bien";

function labelCourt(bien: Bien): string {
  return bien.titre.split(" — ")[0] ?? bien.titre;
}

export default function DossierActionCard({ bien, raison }: { bien: Bien; raison: string }) {
  return (
    <Link href={`/biens/${bien.id}`}>
      <Card variant="interactive">
        <div className="flex items-center gap-3 p-3">
          <IconTile icon={Building2} tone="champagne" size={32} iconSize={15} />
          <p className="text-[14px] leading-snug min-w-0">
            <span className="font-medium text-text-1">{labelCourt(bien)}</span>
            <span className="text-text-2"> — {raison}</span>
          </p>
        </div>
      </Card>
    </Link>
  );
}
