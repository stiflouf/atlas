import Link from "next/link";
import { User, Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import { listerClients } from "@/lib/clientRepository";

const stadeLabel: Record<string, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

// Liste volontairement minimale (nom, budget, stade projet) — la fiche vers laquelle elle
// pointe (/clients/[id]) l'est tout autant : pas d'édition, pas d'historique, hors périmètre.
export default async function ClientsPage() {
  const clients = await listerClients();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">Clients</h1>
          <p className="text-[14px] text-[#94a3b8] mt-1">{clients.length} acquéreurs</p>
        </div>
        <Link
          href="/clients/nouveau"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg shrink-0"
        >
          <Plus size={14} />
          Ajouter un acquéreur
        </Link>
      </div>

      <section>
        <SectionTitle>Acquéreurs</SectionTitle>
        <div className="flex flex-col gap-2">
          {clients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Card className="hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-150">
                <div className="flex items-center gap-4 p-4">
                  <div className="w-10 h-10 rounded-lg bg-[#eef2ff] flex items-center justify-center shrink-0">
                    <User size={18} className="text-[#4338ca]" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[#0f172a] truncate">
                      {client.prenom} {client.nom}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[13px] text-[#64748b]">
                        {formatPrix(client.budgetMin)} – {formatPrix(client.budgetMax)}
                      </span>
                      <Badge variant="default">{stadeLabel[client.stadeProjet] ?? client.stadeProjet}</Badge>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
