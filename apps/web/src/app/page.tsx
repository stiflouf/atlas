import AgendaCard from "@/components/aujourd-hui/AgendaCard";
import RelanceCard from "@/components/aujourd-hui/RelanceCard";
import ActionItem from "@/components/aujourd-hui/ActionItem";
import DossierActionCard from "@/components/aujourd-hui/DossierActionCard";
import SectionTitle from "@/components/ui/SectionTitle";
import { rendezVousDuJour, relances, actionsPrevues } from "@/data/agenda";
import { dossiers } from "@/data/dossier";
import { getActionsPourBien } from "@/data/actions";
import { getBienById } from "@/data/biens";
import type { Bien } from "@/types/bien";
import type { ActionMetier } from "@/types/action";
import { heureDuJour, minutesDepuisMinuit } from "@/lib/temps";
import { statutRendezVous } from "@/lib/rendezVous";
import { actionPrioritaire, raisonAction } from "@/lib/actionPriority";

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

export default function AujourdHui() {
  const dateStr = formatDate();
  const maintenant = new Date();
  const greeting = getGreeting(heureDuJour(maintenant));
  const maintenantEnMinutes = minutesDepuisMinuit(maintenant);

  const rdvAvecStatut = rendezVousDuJour.map((rdv) => ({
    rdv,
    statut: statutRendezVous(rdv, maintenantEnMinutes),
  }));
  const rdvActifs = rdvAvecStatut.filter(({ statut }) => statut !== "termine");
  const rdvTermines = rdvAvecStatut.length - rdvActifs.length;

  const dossiersAttention: { bien: Bien; action: ActionMetier }[] = [];
  for (const dossier of dossiers) {
    const bien = getBienById(dossier.bienId);
    const action = actionPrioritaire(getActionsPourBien(dossier.bienId), maintenant);
    if (bien && action) dossiersAttention.push({ bien, action });
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

      {/* Rendez-vous */}
      <section className="mb-8">
        <SectionTitle>
          {rdvActifs.length > 0
            ? `${rdvActifs.length} rendez-vous restant${rdvActifs.length > 1 ? "s" : ""}`
            : "Aucun rendez-vous restant aujourd'hui"}
        </SectionTitle>
        {rdvActifs.length > 0 && (
          <div className="flex flex-col gap-2">
            {rdvActifs.map(({ rdv, statut }) => (
              <AgendaCard key={rdv.id} rdv={rdv} statut={statut} />
            ))}
          </div>
        )}
        {rdvTermines > 0 && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            {rdvTermines} déjà terminé{rdvTermines > 1 ? "s" : ""} aujourd'hui
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
            {dossiersAttention.map(({ bien, action }) => (
              <DossierActionCard key={bien.id} bien={bien} raison={raisonAction(action)} />
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
