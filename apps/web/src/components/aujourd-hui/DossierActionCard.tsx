import Link from "next/link";
import Card from "@/components/ui/Card";
import type { Bien } from "@/types/bien";

function labelCourt(bien: Bien): string {
  return bien.titre.split(" — ")[0] ?? bien.titre;
}

export default function DossierActionCard({ bien, raison }: { bien: Bien; raison: string }) {
  return (
    <Link href={`/biens/${bien.id}`}>
      <Card className="hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-150">
        <div className="p-4">
          <p className="text-[14px] leading-snug">
            <span className="font-medium text-[#0f172a]">{labelCourt(bien)}</span>
            <span className="text-[#64748b]"> — {raison}</span>
          </p>
        </div>
      </Card>
    </Link>
  );
}
