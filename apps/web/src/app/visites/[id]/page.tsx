import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import { getVisiteById } from "@/lib/visiteRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getCompteRenduVisiteParVisiteId } from "@/lib/compteRenduVisiteRepository";
import { annulerVisiteAction, reporterVisiteAction } from "@/actions/visite";
import { LABEL_STATUT_VISITE } from "@/types/visite";
import { LABEL_INTERET } from "@/types/compteRenduVisite";

type PageProps = { params: Promise<{ id: string }> };

const VARIANT_BADGE_STATUT_VISITE = {
  planifiee: "accent",
  realisee: "success",
  annulee: "muted",
} as const;

const VARIANT_BADGE_INTERET = {
  interesse: "success",
  pas_interesse: "muted",
  a_reflechir: "default",
  inconnu: "default",
} as const;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDateCourte(iso: string): string {
  // `iso` est un `date` SQL (YYYY-MM-DD, jour civil) — jamais une heure (ADR-040/041, Calendar
  // reste seul détenteur de l'heure/durée précises en V1).
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Fiche Visite Atlas (ADR-041) — cœur entièrement dérivé de PostgreSQL, jamais un appel à Google
// Calendar ou une autre API externe : reste consultable même si Calendar est déconnecté, l'OAuth
// expiré, ou l'événement d'origine supprimé côté Google. Calendar n'intervient plus qu'en
// enrichissement secondaire, via le lien conditionnel "Préparer la visite" ci-dessous (visite
// encore `planifiee` uniquement) — jamais une condition d'existence de la fiche elle-même.
export default async function VisitePage({ params }: PageProps) {
  const { id } = await params;
  const visite = await getVisiteById(id);
  if (!visite) notFound();

  const [bien, acquereur, compteRendu] = await Promise.all([
    getBienById(visite.bienId),
    getClientById(visite.acquereurId),
    getCompteRenduVisiteParVisiteId(visite.id),
  ]);
  // Théoriquement impossible (FK CASCADE, biens.id/acquereurs.id) : une visite ne peut pas
  // survivre à la suppression de son bien ou de son acquéreur.
  if (!bien || !acquereur) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Aujourd'hui
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant={VARIANT_BADGE_STATUT_VISITE[visite.statut]}>{LABEL_STATUT_VISITE[visite.statut]}</Badge>
          <span className="text-[13px] text-[#94a3b8]">{formatDateCourte(visite.datePrevue)}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mt-2">
          <Link href={`/biens/${bien.id}`} className="hover:text-[#4338ca] transition-colors">
            {bien.titre}
          </Link>
        </h1>
        <p className="text-[14px] text-[#64748b] mt-0.5">
          {bien.adresse}, {bien.codePostal} {bien.ville}
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <span className="text-[15px] font-semibold text-[#0f172a]">{formatPrix(bien.prix)}</span>
          <span className="text-[13px] text-[#94a3b8]">{bien.surface} m² · {bien.pieces} pièces</span>
        </div>
        <p className="text-[14px] text-[#0f172a] mt-3">
          Acquéreur :{" "}
          <Link href={`/clients/${acquereur.id}`} className="font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
            {acquereur.prenom} {acquereur.nom}
          </Link>
        </p>
      </div>

      {/* Actions — dépendent uniquement du statut persisté, jamais de la disponibilité de
          Calendar. "Préparer la visite" reste le seul point d'entrée vers l'enrichissement
          Calendar-dépendant (transports/écoles/patrimoine/marché + formulaire de compte rendu,
          ADR-040) — secondaire, jamais bloquant pour cette fiche. */}
      {visite.statut === "planifiee" && (
        <section className="mb-8">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Link
              href={`/visites/${visite.rendezVousCalendarId}/preparer`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
            >
              {compteRendu ? "Ouvrir la préparation" : "Préparer / renseigner le compte rendu"}
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <form action={reporterVisiteAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={visite.id} />
              <input type="hidden" name="rendezVousCalendarId" value={visite.rendezVousCalendarId} />
              <input type="hidden" name="redirectTo" value={`/visites/${visite.id}`} />
              <input
                type="date"
                name="nouvelleDatePrevue"
                defaultValue={visite.datePrevue}
                className="border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-[13px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
              />
              <button type="submit" className="text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
                Reporter
              </button>
            </form>
            <form action={annulerVisiteAction}>
              <input type="hidden" name="id" value={visite.id} />
              <input type="hidden" name="rendezVousCalendarId" value={visite.rendezVousCalendarId} />
              <input type="hidden" name="redirectTo" value={`/visites/${visite.id}`} />
              <button type="submit" className="text-[13px] font-medium text-[#64748b] hover:text-[#dc2626] transition-colors">
                Annuler la visite
              </button>
            </form>
          </div>
        </section>
      )}

      {/* Compte rendu — lecture seule ici (ADR-041, §7) : la création reste exclusivement sur la
          page de préparation, jamais un second formulaire dupliqué. */}
      {compteRendu ? (
        <section className="mb-8 border-t border-[#f1f5f9] pt-6">
          <SectionTitle>Compte rendu</SectionTitle>
          <div className="bg-white rounded-lg border border-[#f1f5f9] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-[11px] text-[#94a3b8]">{formatDateCourte(compteRendu.dateVisite)}</p>
              <Badge variant={VARIANT_BADGE_INTERET[compteRendu.interet]}>{LABEL_INTERET[compteRendu.interet]}</Badge>
            </div>
            <p className="text-[14px] text-[#0f172a] leading-relaxed whitespace-pre-wrap">{compteRendu.retour}</p>
            {compteRendu.prochaineEtape && (
              <p className="text-[13px] text-[#94a3b8] mt-2 border-t border-[#f1f5f9] pt-2">
                Prochaine étape : {compteRendu.prochaineEtape}
              </p>
            )}
          </div>
          {/* Créer une offre (ADR-044) — jamais conditionné à `interet` : un acquéreur peut
              formuler explicitement une offre quelle que soit la valeur actuelle de `interet`
              (§5). `visite.statut === "realisee"` revérifié explicitement (défensif, même si un
              compte rendu implique déjà ce statut par construction ADR-041). Ne crée jamais
              l'offre elle-même ici, seulement un lien contextuel vers la route canonique
              /offres/nouveau, préchargé avec les IDs structurés de cette visite — jamais un
              titre/texte libre parsé. */}
          {visite.statut === "realisee" && (
            <Link
              href={`/offres/nouveau?bienId=${bien.id}&acquereurId=${acquereur.id}&compteRenduVisiteId=${compteRendu.id}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg mt-4"
            >
              Créer une offre
            </Link>
          )}
        </section>
      ) : visite.statut === "realisee" ? (
        // Théoriquement impossible aujourd'hui (une visite ne transite vers `realisee` que dans la
        // même transaction que la création de son compte rendu) — affiché honnêtement plutôt que
        // masqué si jamais rencontré, sans inventer de donnée.
        <section className="mb-8 border-t border-[#f1f5f9] pt-6">
          <SectionTitle>Compte rendu</SectionTitle>
          <p className="text-[13px] text-[#94a3b8]">Aucun compte rendu trouvé pour cette visite réalisée.</p>
        </section>
      ) : null}
    </div>
  );
}
