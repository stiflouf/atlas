import AgendaCard from "@/components/aujourd-hui/AgendaCard";
import RelanceCard from "@/components/aujourd-hui/RelanceCard";
import ActionItem from "@/components/aujourd-hui/ActionItem";
import SectionTitle from "@/components/ui/SectionTitle";
import { rendezVousDuJour, relances, actionsPrevues } from "@/data/agenda";

function formatDate(): string {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function AujourdHui() {
  const dateStr = formatDate();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* En-tête */}
      <div className="mb-8">
        <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">
          Bonjour, Steven.
        </h1>
        <p className="text-[14px] text-[#94a3b8] mt-1 capitalize">{dateStr}</p>
      </div>

      {/* Rendez-vous du jour */}
      <section className="mb-8">
        <SectionTitle>
          {rendezVousDuJour.length} rendez-vous aujourd'hui
        </SectionTitle>
        <div className="flex flex-col gap-2">
          {rendezVousDuJour.map((rdv) => (
            <AgendaCard key={rdv.id} rdv={rdv} />
          ))}
        </div>
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

      {/* Prochaines actions */}
      <section>
        <SectionTitle>À faire</SectionTitle>
        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06)] px-4 divide-y divide-[#f1f5f9]">
          {actionsPrevues.map((action) => (
            <ActionItem key={action.id} action={action} />
          ))}
        </div>
      </section>
    </div>
  );
}
