import Link from "next/link";
import AgendaCard from "@/components/aujourd-hui/AgendaCard";
import TacheItem from "@/components/aujourd-hui/TacheItem";
import DossierActionCard from "@/components/aujourd-hui/DossierActionCard";
import AlerteCard from "@/components/alertes/AlerteCard";
import SectionTitle from "@/components/ui/SectionTitle";
import { listerBiens } from "@/lib/bienRepository";
import { listerClients } from "@/lib/clientRepository";
import { listerTaches } from "@/lib/tacheRepository";
import { listerProspectsVendeursArchives } from "@/lib/prospectVendeurRepository";
import type { Bien } from "@/types/bien";
import { deriverStatutTache, type Tache } from "@/types/tache";
import { formatDateISO, formatDateRelative, heureDuJour, minutesDepuisMinuit } from "@/lib/temps";
import { rendezVousAVenir, statutRendezVous } from "@/lib/rendezVous";
import { tachePrioritaire, raisonTache, scoreTache } from "@/lib/tachePriority";
import { getAgendaSemaine } from "@/lib/google/agendaSource";
import { chargerCapacitesGoogle } from "@/lib/google/capacites";
import { construireContexte } from "@/lib/matching";
import { resoudreContextesPersistes } from "@/lib/contexteRepository";
import { chargerContexteAlertes } from "@/lib/alertes/contexte";
import { produireAlertes } from "@/lib/alertes/moteur";

// Alertes affichées directement — au-delà, "Afficher les autres" les développe localement (ADR-026,
// pas de nouvelle route /alertes). Le plan vise "3 à 5" : 5 est le plafond, moins s'il y en a moins.
const NB_ALERTES_PRIORITAIRES = 5;

// Sans cookie (Sprint 4 a retiré le cookie de tokens Google), plus aucune API Next "dynamique"
// n'est appelée ici — une requête Postgres ne suffit pas à elle seule à empêcher la génération
// statique. Cette page dépend de l'heure courante, de l'état live de Google Calendar et des
// décisions humaines en base : elle doit être recalculée à chaque requête, jamais figée au build.
export const dynamic = "force-dynamic";

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

export default async function AujourdHui() {
  const dateStr = formatDate();
  const maintenant = new Date();
  const greeting = getGreeting(heureDuJour(maintenant));
  const maintenantEnMinutes = minutesDepuisMinuit(maintenant);
  const aujourdHuiISO = formatDateISO(maintenant);

  const { rendezVous, source } = await getAgendaSemaine();
  const { gmailAutorise } = await chargerCapacitesGoogle();
  // La fenêtre de lecture couvre 7 jours (utile aux prochains sprints) ; cet écran ne montre
  // que le jour courant. Les rendez-vous mockés n'ont pas de `date` : ils sont toujours
  // considérés comme "aujourd'hui".
  const rendezVousDuJour = rendezVous.filter((rdv) => !rdv.date || rdv.date === aujourdHuiISO);
  // getAgendaSemaine() garantit déjà une fenêtre de 7 jours : pas besoin de la recalculer ici.
  const rdvAVenir = rendezVousAVenir(rendezVous, aujourdHuiISO);

  const [biens, clients, taches, prospectsVendeursArchives, contexteAlertes] = await Promise.all([
    listerBiens(),
    listerClients(),
    listerTaches(),
    listerProspectsVendeursArchives(),
    chargerContexteAlertes(),
  ]);
  const alertes = produireAlertes(contexteAlertes);
  const alertesPrioritaires = alertes.slice(0, NB_ALERTES_PRIORITAIRES);
  const autresAlertes = alertes.slice(NB_ALERTES_PRIORITAIRES);

  // Les rendez-vous Google passent par la mémoire persistée (validation humaine > cache >
  // moteur, cf. ADR-006) ; les mocks n'en ont pas besoin, leur contexte est déjà explicite.
  // Une seule résolution pour aujourd'hui + à venir : même Map, pas de double calcul.
  const rendezVousPertinents = [...rendezVousDuJour, ...rdvAVenir];
  const contextes =
    source === "google_calendar"
      ? await resoudreContextesPersistes(rendezVousPertinents, { biens, clients })
      : new Map(rendezVousPertinents.map((rdv) => [rdv.id, construireContexte(rdv, { biens, clients })]));

  const rdvAvecStatut = rendezVousDuJour.map((rdv) => ({
    rdv,
    statut: statutRendezVous(rdv, maintenantEnMinutes),
    contexte: contextes.get(rdv.id)!,
  }));
  const rdvActifs = rdvAvecStatut.filter(({ statut }) => statut !== "termine");
  const rdvTermines = rdvAvecStatut.length - rdvActifs.length;

  const rdvAVenirAvecContexte = rdvAVenir.map((rdv) => ({
    rdv,
    contexte: contextes.get(rdv.id)!,
    dateLabel: formatDateRelative(rdv.date as string, aujourdHuiISO),
  }));

  // Dérivé directement des tâches réelles (ou mock démo) + des biens réels : plus de dépendance
  // à data/dossier.ts pour cette section. Un bien introuvable (id mocké obsolète, ou bien
  // archivé — biens/clients ne contiennent déjà plus les archivés, ADR-012) est simplement
  // ignoré plutôt que de faire échouer la page. Une tâche 'terminee' OU 'annulee' (ADR-028) est
  // exclue des flux actifs — seule 'a_faire' compte ici.
  const biensParId = new Map(biens.map((bien) => [bien.id, bien]));
  const acquereursParId = new Map(clients.map((client) => [client.id, client]));
  const prospectsVendeursArchivesIds = new Set(prospectsVendeursArchives.map((p) => p.id));
  const tachesActives = taches.filter((t) => deriverStatutTache(t) === "a_faire");

  const tachesParBien = new Map<string, Tache[]>();
  for (const tache of tachesActives) {
    if (!tache.bienId) continue;
    const liste = tachesParBien.get(tache.bienId) ?? [];
    liste.push(tache);
    tachesParBien.set(tache.bienId, liste);
  }

  const dossiersAttention: { bien: Bien; tache: Tache }[] = [];
  for (const [bienId, tachesDuBien] of tachesParBien) {
    const bien = biensParId.get(bienId);
    const tache = tachePrioritaire(tachesDuBien, maintenant);
    if (bien && tache) dossiersAttention.push({ bien, tache });
  }
  dossiersAttention.sort((a, b) => scoreTache(b.tache, maintenant) - scoreTache(a.tache, maintenant));

  // Tâches actives sans bien rattaché (générales, ou liées uniquement à un acquéreur/prospect
  // vendeur). Une tâche liée à un acquéreur archivé (introuvable dans acquereursParId, ADR-012)
  // ou à un prospect vendeur archivé (ADR-027) est exclue des flux actifs, comme les tâches d'un
  // bien archivé le sont déjà via biensParId ci-dessus.
  const autresTaches = tachesActives
    .filter(
      (t) =>
        !t.bienId &&
        (!t.acquereurId || acquereursParId.has(t.acquereurId)) &&
        (!t.prospectVendeurId || !prospectsVendeursArchivesIds.has(t.prospectVendeurId))
    )
    .sort((a, b) => scoreTache(b, maintenant) - scoreTache(a, maintenant));

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* En-tête */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] md:text-[28px] font-semibold text-[#0f172a] leading-tight">
            Aujourd'hui
          </h1>
          <p className="text-[13px] text-[#94a3b8] mt-1 capitalize">
            {greeting} — {dateStr}
          </p>
        </div>
        <Link
          href="/taches/nouveau"
          className="shrink-0 mt-1 text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
        >
          + Nouvelle tâche
        </Link>
      </div>

      {/* Ce qui mérite mon attention (ADR-026) — dérivé à la lecture, jamais persisté. */}
      {alertesPrioritaires.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Ce qui mérite mon attention</SectionTitle>
          <div className="flex flex-col gap-2">
            {alertesPrioritaires.map((alerte) => (
              <AlerteCard key={alerte.id} alerte={alerte} />
            ))}
          </div>
          {autresAlertes.length > 0 && (
            <details className="mt-2">
              <summary className="text-[13px] text-[#4338ca] font-medium cursor-pointer">
                Afficher les autres ({autresAlertes.length})
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                {autresAlertes.map((alerte) => (
                  <AlerteCard key={alerte.id} alerte={alerte} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* Rendez-vous */}
      <section className="mb-8">
        <SectionTitle>
          {rdvActifs.length > 0
            ? `${rdvActifs.length} rendez-vous restant${rdvActifs.length > 1 ? "s" : ""}`
            : "Aucun rendez-vous restant aujourd'hui"}
        </SectionTitle>

        {source === "google_calendar" && (
          <div className="text-[12px] text-[#94a3b8] mb-1">
            Google Calendar : connecté ·{" "}
            <form action="/api/auth/google/logout" method="POST" className="inline">
              {/* La révocation Google est globale (ADR-031-bis) : ce bouton déconnecte aussi Gmail
                  s'il a été autorisé — le libellé le dit explicitement, jamais "Déconnecter
                  Calendar" seul une fois Gmail accordé. */}
              <button type="submit" className="font-medium underline">
                {gmailAutorise ? "Déconnecter Google (Calendar + Gmail)" : "Déconnecter"}
              </button>
            </form>
          </div>
        )}
        {source === "demo" && (
          <div className="text-[12px] text-[#94a3b8] mb-1">
            Source : Données de démonstration ·{" "}
            <a href="/api/auth/google/login" className="text-[#4338ca] font-medium">
              Connecter Google Calendar
            </a>
          </div>
        )}
        {source === "demo_erreur" && (
          <div className="text-[12px] text-[#b45309] mb-1">
            Google Calendar indisponible — données de démonstration affichées ·{" "}
            <a href="/api/auth/google/login?reconnexion=1" className="font-medium underline">
              Se reconnecter
            </a>
          </div>
        )}
        {/* Capacité distincte de Calendar (ADR-031-bis) : jamais un simple "Google connecté" —
            le conseiller doit voir explicitement ce qui est autorisé pour l'envoi d'emails. */}
        <div className="text-[12px] text-[#94a3b8] mb-3">
          Gmail : {gmailAutorise ? "autorisé" : "non autorisé"}
          {!gmailAutorise && (
            <>
              {" "}
              ·{" "}
              <a href="/api/auth/google/gmail/login" className="text-[#4338ca] font-medium">
                Autoriser Gmail
              </a>
            </>
          )}
        </div>

        {rdvActifs.length > 0 && (
          <div className="flex flex-col gap-2">
            {rdvActifs.map(({ rdv, statut, contexte }) => (
              <AgendaCard key={rdv.id} rdv={rdv} statut={statut} contexte={contexte} />
            ))}
          </div>
        )}
        {rdvTermines > 0 && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            {rdvTermines} déjà terminé{rdvTermines > 1 ? "s" : ""} aujourd'hui
          </p>
        )}
      </section>

      {/* À venir (7 prochains jours, hors aujourd'hui) */}
      {rdvAVenirAvecContexte.length > 0 && (
        <section className="mb-8">
          <SectionTitle>
            {rdvAVenirAvecContexte.length} rendez-vous à venir
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {rdvAVenirAvecContexte.map(({ rdv, contexte, dateLabel }) => (
              <AgendaCard key={rdv.id} rdv={rdv} statut="a_venir" contexte={contexte} dateLabel={dateLabel} />
            ))}
          </div>
        </section>
      )}

      {/* Dossiers nécessitant une tâche */}
      {dossiersAttention.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Dossiers nécessitant une action</SectionTitle>
          <div className="flex flex-col gap-2">
            {dossiersAttention.map(({ bien, tache }) => (
              <DossierActionCard key={bien.id} bien={bien} raison={raisonTache(tache)} />
            ))}
          </div>
        </section>
      )}

      {/* Autres tâches (sans bien rattaché) */}
      {autresTaches.length > 0 && (
        <section>
          <SectionTitle>
            {autresTaches.length} autre{autresTaches.length > 1 ? "s" : ""} tâche
            {autresTaches.length > 1 ? "s" : ""}
          </SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06)] px-4 divide-y divide-[#f1f5f9]">
            {autresTaches.map((tache) => (
              <TacheItem key={tache.id} tache={tache} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
