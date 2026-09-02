import { CalendarCheck, Building2, ListChecks, AlertCircle } from "lucide-react";
import AgendaCard from "@/components/aujourd-hui/AgendaCard";
import TacheItem from "@/components/aujourd-hui/TacheItem";
import DossierActionCard from "@/components/aujourd-hui/DossierActionCard";
import OpportuniteCard from "@/components/aujourd-hui/OpportuniteCard";
import ConnexionsGoogle from "@/components/aujourd-hui/ConnexionsGoogle";
import AlerteCard from "@/components/alertes/AlerteCard";
import SectionTitle from "@/components/ui/SectionTitle";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import IconTile from "@/components/ui/IconTile";
import EmptyState from "@/components/ui/EmptyState";
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
import { chargerContexteOpportunites } from "@/lib/opportunites/contexte";
import { detecterOpportunites } from "@/lib/opportunites/moteur";
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

  // VALUE-01 — opportunités commerciales dérivées à la lecture (jamais persistées), à partir des
  // collections déjà chargées ci-dessus plus prospects/visites/comptes rendus/compatibilités. La
  // déduplication contre `tachesActives` vit dans le moteur : une action déjà portée par une tâche
  // ouverte n'est jamais montrée deux fois.
  const opportunites = detecterOpportunites(
    await chargerContexteOpportunites({ biens, acquereurs: clients, tachesActives }),
    maintenant
  );

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
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      {/* En-tête */}
      <div className="mb-7 flex items-end justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-champagne">{greeting}</p>
          <h1 className="font-serif text-[28px] md:text-[34px] font-semibold text-text-primary leading-[1.05] mt-1.5">
            Aujourd'hui
          </h1>
          <p className="text-[13px] text-text-muted mt-1.5 first-letter:uppercase">{dateStr}</p>
        </div>
        <ButtonLink href="/taches/nouveau" variant="primary" size="md">
          + Nouvelle tâche
        </ButtonLink>
      </div>

      {/* Repères chiffrés (chantier fidélité visuelle) — 4 comptages déjà calculés ci-dessus pour
          les sections existantes, aucune requête ni règle supplémentaire : biens.length vient de
          listerBiens() (ligne Promise.all), les trois autres des dérivations déjà en place. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
        <StatTile icon={AlertCircle} valeur={dossiersAttention.length} libelle="Dossiers à traiter" taille="lead" />
        <StatTile icon={CalendarCheck} valeur={rdvActifs.length} libelle="RDV restants" taille="kpi" />
        <StatTile icon={ListChecks} valeur={tachesActives.length} libelle="Tâches actives" taille="kpi" />
        <StatTile icon={Building2} valeur={biens.length} libelle="Biens actifs" taille="kpi" />
      </div>

      {/* Composition en 2 colonnes sur desktop (passe enrichissement visuel) — colonne principale :
          agenda + dossiers actionnables ; colonne secondaire, plus dense : attention + tâches sans
          bien. Mobile reste empilé (ordre naturel du flux). Aucune section supprimée/ajoutée. */}
      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-6 lg:items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {/* Rendez-vous */}
          <section>
            <SectionTitle>
              {rdvActifs.length > 0
                ? `${rdvActifs.length} rendez-vous restant${rdvActifs.length > 1 ? "s" : ""}`
                : "Aucun rendez-vous restant aujourd'hui"}
            </SectionTitle>

            {rdvActifs.length > 0 && (
              <div className="flex flex-col">
                {rdvActifs.map(({ rdv, statut, contexte }, i) => (
                  <AgendaCard
                    key={rdv.id}
                    rdv={rdv}
                    statut={statut}
                    contexte={contexte}
                    dernier={i === rdvActifs.length - 1}
                  />
                ))}
              </div>
            )}
            {rdvActifs.length === 0 && (
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <IconTile icon={CalendarCheck} tone="champagne" size={34} iconSize={16} />
                  <p className="text-[13.5px] leading-snug text-text-secondary">
                    Plus aucun rendez-vous d'ici ce soir.
                    {rdvAVenirAvecContexte.length > 0 && (
                      <span className="text-text-muted"> La suite est en « à venir » ci-dessous.</span>
                    )}
                  </p>
                </div>
              </Card>
            )}
            {rdvTermines > 0 && (
              <p className="text-[12px] text-text-muted mt-1">
                {rdvTermines} déjà terminé{rdvTermines > 1 ? "s" : ""} aujourd'hui
              </p>
            )}

            <ConnexionsGoogle source={source} gmailAutorise={gmailAutorise} />
          </section>

          {/* À venir (7 prochains jours, hors aujourd'hui) */}
          {rdvAVenirAvecContexte.length > 0 && (
            <section>
              <SectionTitle>{rdvAVenirAvecContexte.length} rendez-vous à venir</SectionTitle>
              <div className="flex flex-col">
                {rdvAVenirAvecContexte.map(({ rdv, contexte, dateLabel }, i) => (
                  <AgendaCard
                    key={rdv.id}
                    rdv={rdv}
                    statut="a_venir"
                    contexte={contexte}
                    dateLabel={dateLabel}
                    dernier={i === rdvAVenirAvecContexte.length - 1}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Dossiers nécessitant une tâche */}
          {dossiersAttention.length > 0 && (
            <section>
              <SectionTitle>Dossiers nécessitant une action</SectionTitle>
              <div className="flex flex-col gap-2">
                {dossiersAttention.map(({ bien, tache }) => (
                  <DossierActionCard key={bien.id} bien={bien} raison={raisonTache(tache)} />
                ))}
              </div>
            </section>
          )}

          {/* Opportunités (VALUE-01) — colonne principale, sous les dossiers déjà pris en charge
              par une tâche : ce sont les situations que rien ne couvre encore. Wording sobre, aucun
              score, aucune mention d'IA (il n'y en a pas). */}
          {opportunites.length > 0 && (
            <section>
              <SectionTitle>
                {opportunites.length} opportunité{opportunites.length > 1 ? "s" : ""}
              </SectionTitle>
              <div className="flex flex-col gap-2">
                {opportunites.map((opportunite) => (
                  <OpportuniteCard key={opportunite.id} opportunite={opportunite} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Colonne secondaire — plus dense, jamais une card pleine largeur pour 3 lignes. */}
        <div className="flex flex-col gap-5 mt-6 lg:mt-0">
          {/* Ce qui mérite mon attention (ADR-026) — dérivé à la lecture, jamais persisté. */}
          {alertesPrioritaires.length > 0 && (
            <section>
              <SectionTitle>Ce qui mérite mon attention</SectionTitle>
              <div className="flex flex-col gap-2">
                {alertesPrioritaires.map((alerte) => (
                  <AlerteCard key={alerte.id} alerte={alerte} />
                ))}
              </div>
              {autresAlertes.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[13px] text-action-primary font-medium cursor-pointer">
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

          {/* Autres tâches (sans bien rattaché) */}
          {autresTaches.length > 0 && (
            <section>
              <SectionTitle>
                {autresTaches.length} autre{autresTaches.length > 1 ? "s" : ""} tâche
                {autresTaches.length > 1 ? "s" : ""}
              </SectionTitle>
              <Card className="px-4 divide-y divide-border-subtle">
                {autresTaches.map((tache) => (
                  <TacheItem key={tache.id} tache={tache} />
                ))}
              </Card>
            </section>
          )}
        </div>
      </div>

      {/* État vide (ADR-039) — scopé aux seules actions/tâches : n'apparaît jamais si l'agenda ou
          les alertes ont par ailleurs du contenu, seulement quand il n'y a structurellement rien à
          traiter dans les deux sections ci-dessus. */}
      {dossiersAttention.length === 0 && autresTaches.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={ListChecks}
            titre="Rien à traiter pour le moment"
            message="Aucun dossier ni tâche n'attend d'action. Les nouveaux rendez-vous et relances apparaîtront ici."
          />
        </div>
      )}
    </div>
  );
}
