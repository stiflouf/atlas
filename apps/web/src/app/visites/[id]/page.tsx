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
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import { getTachesPourAcquereur, getTachesPourProspectVendeur } from "@/lib/tacheRepository";
import { getProspectVendeurParBien } from "@/lib/prospectVendeurRepository";
import { listerConfigurationsAutomatisation } from "@/lib/automatisations/configurationAutomatisationRepository";
import { construireSuiteVisite } from "@/lib/visites/suiteVisite";
import { creerTacheProchaineEtapeAction } from "@/actions/creerTacheProchaineEtape";

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

  // VALUE-02 — tout ce qui suit sert uniquement à RENDRE VISIBLE l'orchestration post-visite déjà
  // en place (ADR-041/042/044). Chargé seulement quand un compte rendu existe : une visite encore
  // planifiée n'a aucune suite à recommander.
  const prospectVendeur = compteRendu ? await getProspectVendeurParBien(bien.id) : undefined;
  const [tachesAcquereur, tachesVendeur, configurations] = compteRendu
    ? await Promise.all([
        getTachesPourAcquereur(acquereur.id),
        prospectVendeur ? getTachesPourProspectVendeur(prospectVendeur.id) : Promise.resolve([]),
        listerConfigurationsAutomatisation(),
      ])
    : [[], [], []];

  const suite = compteRendu
    ? construireSuiteVisite({ acquereur, prospectVendeur, compteRendu, tachesAcquereur, tachesVendeur })
    : undefined;

  // Information secondaire, jamais un avertissement : si ces règles sont inactives, aucune tâche
  // automatique n'a pu être créée après cette visite — le dire évite de laisser croire à un oubli
  // du produit. Aucune activation n'est faite ici, jamais.
  const automatisationsPostVisiteInactives = configurations
    .filter((c) => (c.regleCode === "suivi_apres_visite" || c.regleCode === "retour_vendeur_apres_visite") && !c.active)
    .length;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Aujourd'hui
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant={VARIANT_BADGE_STATUT_VISITE[visite.statut]}>{LABEL_STATUT_VISITE[visite.statut]}</Badge>
          <span className="text-[13px] text-text-3">{formatDateCourte(visite.datePrevue)}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mt-2">
          <Link href={`/biens/${bien.id}`} className="hover:text-accent transition-colors">
            {bien.titre}
          </Link>
        </h1>
        <p className="text-[14px] text-text-2 mt-0.5">
          {bien.adresse}, {bien.codePostal} {bien.ville}
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <span className="text-[15px] font-semibold text-text-1">{formatPrix(bien.prix)}</span>
          <span className="text-[13px] text-text-3">{bien.surface} m² · {bien.pieces} pièces</span>
        </div>
        <p className="text-[14px] text-text-1 mt-3">
          Acquéreur :{" "}
          <Link href={`/clients/${acquereur.id}`} className="font-medium text-accent hover:text-accent-hover transition-colors">
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
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg"
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
                className="border border-border-md rounded-lg px-2 py-1.5 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
              <button type="submit" className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
                Reporter
              </button>
            </form>
            <form action={annulerVisiteAction}>
              <input type="hidden" name="id" value={visite.id} />
              <input type="hidden" name="rendezVousCalendarId" value={visite.rendezVousCalendarId} />
              <input type="hidden" name="redirectTo" value={`/visites/${visite.id}`} />
              <button type="submit" className="text-[13px] font-medium text-text-2 hover:text-danger transition-colors">
                Annuler la visite
              </button>
            </form>
          </div>
        </section>
      )}

      {/* Compte rendu — lecture seule ici (ADR-041, §7) : la création reste exclusivement sur la
          page de préparation, jamais un second formulaire dupliqué. */}
      {compteRendu ? (
        <section className="mb-8 border-t border-border pt-6">
          <SectionTitle>Compte rendu</SectionTitle>
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-[11px] text-text-3">{formatDateCourte(compteRendu.dateVisite)}</p>
              <Badge variant={VARIANT_BADGE_INTERET[compteRendu.interet]}>{LABEL_INTERET[compteRendu.interet]}</Badge>
            </div>
            <p className="text-[14px] text-text-1 leading-relaxed whitespace-pre-wrap">{compteRendu.retour}</p>
            {compteRendu.prochaineEtape && (
              <p className="text-[13px] text-text-3 mt-2 border-t border-border pt-2">
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
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg mt-4"
            >
              Créer une offre
            </Link>
          )}
        </section>
      ) : visite.statut === "realisee" ? (
        // Théoriquement impossible aujourd'hui (une visite ne transite vers `realisee` que dans la
        // même transaction que la création de son compte rendu) — affiché honnêtement plutôt que
        // masqué si jamais rencontré, sans inventer de donnée.
        <section className="mb-8 border-t border-border pt-6">
          <SectionTitle>Compte rendu</SectionTitle>
          <p className="text-[13px] text-text-3">Aucun compte rendu trouvé pour cette visite réalisée.</p>
        </section>
      ) : null}

      {/* Suite recommandée (VALUE-02) — ne décide rien de neuf : rend visibles les parcours déjà
          prévus par ADR-041 (suivi acquéreur), ADR-042 (retour vendeur) et les tâches réellement
          ouvertes. Aucun état post-visite inventé, aucun score, aucune action automatique. */}
      {compteRendu && suite && (
        <section className="mb-8">
          <SectionTitle>Suite recommandée</SectionTitle>
          <Card className="p-4 flex flex-col gap-3.5">
            {/* Le badge ne porte que `interet`, donnée structurée déjà saisie — jamais un état
                post-visite calculé pour l'occasion. */}
            <div className="flex items-start gap-2.5">
              <Badge variant={VARIANT_BADGE_INTERET[compteRendu.interet]}>{LABEL_INTERET[compteRendu.interet]}</Badge>
              <p className="text-[14px] text-text-1">{suite.raison}</p>
            </div>

            {suite.prochaineEtape && (
              <div className="border-t border-border pt-3">
                <p className="text-[11px] font-medium text-text-2">Prochaine étape prévue</p>
                <p className="text-[14px] text-text-1 mt-0.5 whitespace-pre-wrap">« {suite.prochaineEtape} »</p>
                {suite.proposerTacheDepuisProchaineEtape && (
                  <form action={creerTacheProchaineEtapeAction} className="mt-2.5">
                    <input type="hidden" name="visiteId" value={visite.id} />
                    {/* Geste explicite du conseiller — seul chemin par lequel une prochaine étape
                        devient une tâche. Jamais déclenché par l'enregistrement du compte rendu. */}
                    <Button type="submit" variant="secondary" size="md">
                      Créer une tâche
                    </Button>
                  </form>
                )}
              </div>
            )}

            {suite.tachesPlanifiees.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-[11px] font-medium text-text-2 mb-1.5">Suivis déjà planifiés</p>
                <ul className="flex flex-col gap-1">
                  {suite.tachesPlanifiees.map((t) => (
                    <li key={t.id} className="text-[13.5px] text-text-1 leading-snug">
                      · {t.titre}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {suite.actions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-3">
                {suite.actions.map((action) => (
                  <ButtonLink
                    key={action.cle}
                    href={action.href}
                    variant={action.principale ? "primary" : "secondary"}
                    size="md"
                  >
                    {action.libelle}
                  </ButtonLink>
                ))}
              </div>
            )}

            {/* Information secondaire, jamais un avertissement : explique pourquoi aucune tâche
                automatique n'a été créée, sans rien imposer ni rien activer. */}
            {automatisationsPostVisiteInactives > 0 && (
              <p className="text-[11px] text-text-3 border-t border-border pt-3">
                Le suivi automatique après visite n'est pas activé.{" "}
                <Link href="/automatisations" className="underline hover:text-text-2 transition-colors">
                  Configurer
                </Link>
              </p>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
