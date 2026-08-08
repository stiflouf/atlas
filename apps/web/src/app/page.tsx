import AgendaCard from "@/components/aujourd-hui/AgendaCard";
import RelanceCard from "@/components/aujourd-hui/RelanceCard";
import ActionItem from "@/components/aujourd-hui/ActionItem";
import DossierActionCard from "@/components/aujourd-hui/DossierActionCard";
import SectionTitle from "@/components/ui/SectionTitle";
import { rendezVousDuJour, relances, actionsPrevues } from "@/data/agenda";
import { getDossiersAvecAttention, type DossierBien } from "@/data/dossier";
import { getBienById } from "@/data/biens";
import type { Bien } from "@/types/bien";

function formatDate(): string {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

function parseHeureEnMinutes(heure: string): number {
  const [h, m] = heure.replace("h", ":").split(":");
  return parseInt(h, 10) * 60 + parseInt(m || "0", 10);
}

export default function AujourdHui() {
  const dateStr = formatDate();
  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const rdvAVenir = rendezVousDuJour.filter((rdv) => parseHeureEnMinutes(rdv.heure) >= nowMinutes);
  const rdvPasses = rendezVousDuJour.length - rdvAVenir.length;

  const dossiersAttention: { dossier: DossierBien; bien: Bien }[] = [];
  for (const dossier of getDossiersAvecAttention()) {
    const bien = getBienById(dossier.bienId);
    if (bien) dossiersAttention.push({ dossier, bien });
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* En-tête */}
      <div className="mb-8">
        <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">
          Aujourd'hui
        </h1>
        <p className="text-[13px] text-[#94a3b8] mt-1 capitalize">
          {greeting} — {dateStr}
        </p>
      </div>

      {/* Rendez-vous à venir */}
      <section className="mb-8">
        <SectionTitle>
          {rdvAVenir.length > 0
            ? `${rdvAVenir.length} rendez-vous à venir`
            : "Aucun rendez-vous restant aujourd'hui"}
        </SectionTitle>
        {rdvAVenir.length > 0 && (
          <div className="flex flex-col gap-2">
            {rdvAVenir.map((rdv) => (
              <AgendaCard key={rdv.id} rdv={rdv} />
            ))}
          </div>
        )}
        {rdvPasses > 0 && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            {rdvPasses} déjà passé{rdvPasses > 1 ? "s" : ""} aujourd'hui
          </p>
        )}
      </section>

      {/* Relances */}
      {relances.length > 0 && (
        <section className="mb-8">
          <SectionTitle>
            {relances.length} relance{relances.length > 1 ? "s" : ""} en attente
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {relances.map((r) => (
              <RelanceCard key={r.id} relance={r} />
            ))}
          </div>
        </section>
      )}

      {/* Dossiers nécessitant une action */}
      {dossiersAttention.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Dossiers nécessitant une action</SectionTitle>
          <div className="flex flex-col gap-2">
            {dossiersAttention.map(({ dossier, bien }) => (
              <DossierActionCard key={dossier.bienId} bien={bien} raison={dossier.raisonAttention!} />
            ))}
          </div>
        </section>
      )}

      {/* Tâches à préparer */}
      <section>
        <SectionTitle>Tâches à préparer</SectionTitle>
        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06)] px-4 divide-y divide-[#f1f5f9]">
          {actionsPrevues.map((action) => (
            <ActionItem key={action.id} action={action} />
          ))}
        </div>
      </section>
    </div>
  );
}
