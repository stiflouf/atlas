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
import { enregistrerCompteRenduVisiteAction } from "@/actions/enregistrerCompteRenduVisite";
import { creerBonVisiteAction } from "@/actions/bonVisite";
import { listerBonsVisitePourVisite } from "@/lib/bonVisiteRepository";
import { LABEL_STATUT_BON_VISITE } from "@/types/bonVisite";
import { enregistrerRetourVendeurVisiteAction } from "@/actions/retourVendeurVisite";
import { vendeursCanoniquesDuBien } from "@/lib/retourVendeurVisiteRepository";
import { listerInteractionsPourVisite } from "@/lib/interactionRepository";
import { LABEL_TYPE_INTERACTION, type TypeInteraction } from "@/types/interaction";
import { LABEL_STATUT_VISITE } from "@/types/visite";
import { LABEL_INTERET, type Interet } from "@/types/compteRenduVisite";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import { getTachesPourAcquereur, getTachesPourProspectVendeur } from "@/lib/tacheRepository";
import { getProspectVendeurParBien } from "@/lib/prospectVendeurRepository";
import { listerConfigurationsAutomatisation } from "@/lib/automatisations/configurationAutomatisationRepository";
import { construireSuiteVisite } from "@/lib/visites/suiteVisite";
import { creerTacheProchaineEtapeAction } from "@/actions/creerTacheProchaineEtape";
import { nomComplet } from "@/lib/identite/nomPersonne";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { formatDateISO } from "@/lib/temps";
import { lienRetourFicheVisite, retourVisiteValide } from "@/lib/visites/retourVisite";

// `retour` (VISIT_NATIVE_ENTRY_V1) : provenance d'ouverture, enum fermé (bien | acquereur) — toute
// autre valeur retombe sur le retour historique vers Aujourd'hui.
type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ retour?: string; erreurRetourVendeur?: string }>;
};

// DEMO_UX_HARDENING_V1 — `enregistrerRetourVendeurVisiteAction` rapportait déjà ses refus par
// `?erreurRetourVendeur=<statut>`, mais personne ne lisait le paramètre : un refus ressemblait à un
// clic sans effet. Les CINQ statuts de refus du writer (le sixième, `enregistre`, est le succès)
// sont traduits ici, et EUX SEULS : un code inconnu (URL bricolée) n'affiche rien plutôt qu'un
// texte arbitraire ou la valeur brute.
const MESSAGE_REFUS_RETOUR_VENDEUR: Record<string, string> = {
  deja_enregistre: "Le retour vendeur a déjà été enregistré pour cette visite.",
  introuvable: "Cette visite est introuvable.",
  visite_non_realisee: "Le retour vendeur ne s'enregistre qu'une fois la visite réalisée.",
  aucun_vendeur_canonique: "Aucun vendeur n'est rattaché au mandat de ce bien : ajoutez un mandant avant d'enregistrer son retour.",
  contact_fusionne: "Le vendeur a été fusionné dans un autre contact : reprenez depuis la fiche conservée.",
};

const VARIANT_BADGE_STATUT_VISITE = {
  planifiee: "accent",
  realisee: "success",
  annulee: "muted",
} as const;

const VARIANT_BADGE_STATUT_BON = { brouillon: "accent", signe: "success", annule: "muted" } as const;

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
export default async function VisitePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const workspaceId = await exigerWorkspaceCourant();
  const visite = await getVisiteById(id, workspaceId);
  if (!visite) notFound();
  const parametres = await searchParams;
  const lienRetour = lienRetourFicheVisite(retourVisiteValide(parametres?.retour), visite);
  const refusRetourVendeur = parametres?.erreurRetourVendeur
    ? MESSAGE_REFUS_RETOUR_VENDEUR[parametres.erreurRetourVendeur]
    : undefined;

  const [bien, acquereur, compteRendu, bonsVisite] = await Promise.all([
    getBienById(visite.bienId),
    getClientById(visite.acquereurId),
    getCompteRenduVisiteParVisiteId(visite.id, workspaceId),
    listerBonsVisitePourVisite(visite.id, workspaceId),
  ]);
  // Théoriquement impossible (FK CASCADE, biens.id/acquereurs.id) : une visite ne peut pas
  // survivre à la suppression de son bien ou de son acquéreur.
  if (!bien || !acquereur) notFound();

  // §25 du brief VISIT_SIGNED_FORM_V1 — le bon COURANT est le plus récent (listerBonsVisitePourVisite
  // trie déjà par version décroissante) ; l'historique complet (versions antérieures) reste
  // consultable en ouvrant chacune depuis son propre lien, jamais affiché en boucle ici (§59, borné :
  // un seul bon rendu sur cette fiche, jamais N+1 sur l'historique complet).
  const bonCourant = bonsVisite[0];

  // VALUE-02 — tout ce qui suit sert uniquement à RENDRE VISIBLE l'orchestration post-visite déjà
  // en place (ADR-041/042/044). Chargé seulement quand un compte rendu existe : une visite encore
  // planifiée n'a aucune suite à recommander.
  const prospectVendeur = compteRendu ? await getProspectVendeurParBien(bien.id) : undefined;
  const [tachesAcquereur, tachesVendeur, configurations] = compteRendu
    ? await Promise.all([
        getTachesPourAcquereur(acquereur.id),
        prospectVendeur ? getTachesPourProspectVendeur(prospectVendeur.id) : Promise.resolve([]),
        // WORKSPACE_SCOPING_V2B5 — scopée comme les autres lectures de cet écran : la suite
        // recommandée dépend des règles actives DE CE workspace, jamais de celles d'un autre.
        listerConfigurationsAutomatisation(workspaceId),
      ])
    : [[], [], []];

  const suite = compteRendu
    ? construireSuiteVisite({ acquereur, prospectVendeur, compteRendu, tachesAcquereur, tachesVendeur })
    : undefined;

  // SELLER_FEEDBACK_INTERACTION_V1 (ADR-063) — chargé uniquement pour une Visite realisee (§21 :
  // le retour vendeur post-visite n'a de sens que là). `interactionsRetourVendeur` filtre déjà en
  // base sur `nature_metier` — jamais un filtrage en mémoire sur toutes les interactions de la Visite.
  const [vendeursCanoniques, interactionsRetourVendeur] =
    visite.statut === "realisee"
      ? await Promise.all([
          vendeursCanoniquesDuBien(bien.id, workspaceId),
          listerInteractionsPourVisite(visite.id, workspaceId).then((liste) =>
            liste.filter((i) => i.natureMetier === "retour_vendeur_post_visite")
          ),
        ])
      : [[], []];

  // Information secondaire, jamais un avertissement : si ces règles sont inactives, aucune tâche
  // automatique n'a pu être créée après cette visite — le dire évite de laisser croire à un oubli
  // du produit. Aucune activation n'est faite ici, jamais.
  const automatisationsPostVisiteInactives = configurations
    .filter((c) => (c.regleCode === "suivi_apres_visite" || c.regleCode === "retour_vendeur_apres_visite") && !c.active)
    .length;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={lienRetour.href}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {lienRetour.label}
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
            {nomComplet(acquereur)}
          </Link>
        </p>
      </div>

      {/* Actions — dépendent uniquement du statut persisté, jamais de la disponibilité de
          Calendar. "Préparer la visite" reste le seul point d'entrée vers l'enrichissement
          Calendar-dépendant (transports/écoles/patrimoine/marché + formulaire de compte rendu,
          ADR-040) — secondaire, jamais bloquant pour cette fiche. VISIT_NATIVE_LIFECYCLE_V1
          (ADR-063) — absent quand `rendezVousCalendarId` est undefined (visite native, aucun
          rendez-vous Calendar à préparer) : le compte rendu s'enregistre alors directement ici,
          via le formulaire minimal ci-dessous (NATIVE_PREPARATION = DEFERRED — pas
          d'enrichissement contextuel pour une visite native en V1, mais un cycle de vie complet). */}
      {visite.statut === "planifiee" && (
        <section className="mb-8">
          {visite.rendezVousCalendarId && (
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Link
                href={`/visites/${visite.rendezVousCalendarId}/preparer`}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg"
              >
                {compteRendu ? "Ouvrir la préparation" : "Préparer / renseigner le compte rendu"}
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <form action={reporterVisiteAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={visite.id} />
              <input type="hidden" name="rendezVousCalendarId" value={visite.rendezVousCalendarId ?? ""} />
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
              <input type="hidden" name="rendezVousCalendarId" value={visite.rendezVousCalendarId ?? ""} />
              <input type="hidden" name="redirectTo" value={`/visites/${visite.id}`} />
              <button type="submit" className="text-[13px] font-medium text-text-2 hover:text-danger transition-colors">
                Annuler la visite
              </button>
            </form>
          </div>

          {/* Compte rendu natif (ADR-063) — seul chemin d'écriture pour une visite sans
              rendez-vous Calendar : mêmes champs que le formulaire de /preparer, sans
              l'enrichissement contextuel (Calendar-dépendant). */}
          {!visite.rendezVousCalendarId && (
            <form action={enregistrerCompteRenduVisiteAction} className="flex flex-col gap-4 mt-6 border-t border-border pt-6">
              <input type="hidden" name="bienId" value={bien.id} />
              <input type="hidden" name="acquereurId" value={acquereur.id} />
              <input type="hidden" name="visiteId" value={visite.id} />

              <div>
                <label className="text-[12px] font-medium text-text-2 mb-1 block">Date de la visite</label>
                <input
                  type="date"
                  name="dateVisite"
                  defaultValue={visite.datePrevue || formatDateISO(new Date())}
                  required
                  className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-text-2 mb-1 block">Intérêt de l'acquéreur</label>
                <div className="flex flex-wrap gap-3">
                  {(Object.keys(LABEL_INTERET) as Interet[]).map((valeur) => (
                    <label key={valeur} className="inline-flex items-center gap-1.5 text-[13px] text-text-1">
                      <input type="radio" name="interet" value={valeur} defaultChecked={valeur === "inconnu"} />
                      {LABEL_INTERET[valeur]}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-text-2 mb-1 block">Retour libre</label>
                <textarea
                  name="retour"
                  rows={4}
                  required
                  placeholder="Ce que vous avez observé, ce que l'acquéreur a dit..."
                  className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-text-2 mb-1 block">
                  Prochaine étape (optionnel)
                </label>
                <textarea
                  name="prochaineEtape"
                  rows={2}
                  placeholder="Ex. Envoyer une contre-proposition, relancer dans une semaine..."
                  className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              <button
                type="submit"
                className="self-start text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg"
              >
                Enregistrer le compte rendu
              </button>
            </form>
          )}
        </section>
      )}

      {/* Bon de visite (§25 du brief VISIT_SIGNED_FORM_V1, ADR-063) — jamais couplé au compte
          rendu/au statut de la Visite (§38 : indépendants) : un bon peut être créé/signé sur une
          visite planifiée ou réalisée (§36/§37), jamais sur une visite annulée (garde côté writer,
          creerBonVisite). Quatre états : aucun bon, brouillon, signé, annulé. */}
      <section className="mb-8 border-t border-border pt-6">
        <SectionTitle>Bon de visite</SectionTitle>
        {!bonCourant && visite.statut !== "annulee" && (
          <form action={creerBonVisiteAction}>
            <input type="hidden" name="visiteId" value={visite.id} />
            <Button type="submit" variant="secondary" size="md">
              Créer le bon de visite
            </Button>
          </form>
        )}
        {!bonCourant && visite.statut === "annulee" && (
          <p className="text-[13px] text-text-3">Aucun bon de visite n'a été créé pour cette visite annulée.</p>
        )}
        {bonCourant && (
          <div className="bg-surface rounded-lg border border-border p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant={VARIANT_BADGE_STATUT_BON[bonCourant.statut]}>{LABEL_STATUT_BON_VISITE[bonCourant.statut]}</Badge>
              <span className="text-[12px] text-text-3">Version {bonCourant.version}</span>
            </div>
            {bonCourant.statut === "brouillon" && (
              <ButtonLink href={`/visites/${visite.id}/bon-de-visite/${bonCourant.id}`} variant="primary" size="sm">
                Ouvrir / faire signer
              </ButtonLink>
            )}
            {bonCourant.statut === "signe" && (
              <ButtonLink href={`/api/bons-visite/${bonCourant.id}/document`} variant="secondary" size="sm">
                Télécharger le document signé
              </ButtonLink>
            )}
            {bonCourant.statut === "annule" && visite.statut !== "annulee" && (
              <form action={creerBonVisiteAction}>
                <input type="hidden" name="visiteId" value={visite.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Créer un nouveau bon
                </Button>
              </form>
            )}
          </div>
        )}
      </section>

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

      {/* Retour vendeur (SELLER_FEEDBACK_INTERACTION_V1, ADR-063) — le retour vendeur devient un
          fait CRM canonique (Interaction), jamais seulement une tâche cochée. Visible uniquement
          sur une Visite realisee (§21) : la tâche `retour_vendeur_apres_visite` reste "travail à
          faire" (Suite recommandée ci-dessus), l'Interaction ci-dessous en est la preuve/l'historique. */}
      {visite.statut === "realisee" && (
        <section className="mb-8 border-t border-border pt-6">
          <SectionTitle>Retour vendeur</SectionTitle>
          {refusRetourVendeur && (
            <p
              role="alert"
              className="text-[13px] text-status-danger bg-status-danger-subtle border border-status-danger-border rounded-lg px-3 py-2 mb-3"
            >
              {refusRetourVendeur}
            </p>
          )}
          {interactionsRetourVendeur.length > 0 ? (
            <div className="flex flex-col gap-2">
              {interactionsRetourVendeur.map((interaction) => {
                const vendeur = vendeursCanoniques.find((v) => v.contactId === interaction.contactId);
                return (
                  <div key={interaction.id} className="bg-surface rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="success">Retour effectué</Badge>
                      <span className="text-[11px] text-text-3">
                        {new Date(interaction.survenuLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                        {" · "}
                        {LABEL_TYPE_INTERACTION[interaction.type]}
                        {vendeur && ` · ${[vendeur.prenom, vendeur.nom].filter(Boolean).join(" ")}`}
                      </span>
                    </div>
                    {interaction.contenu && <p className="text-[13.5px] text-text-1 whitespace-pre-wrap">{interaction.contenu}</p>}
                  </div>
                );
              })}
            </div>
          ) : vendeursCanoniques.length === 0 ? (
            <p className="text-[13px] text-text-3">
              Aucun vendeur canonique identifié pour ce bien (mandat/parties non renseignés) — le retour
              vendeur ne peut pas être enregistré tant qu'aucun mandant n'est rattaché.
            </p>
          ) : (
            <form action={enregistrerRetourVendeurVisiteAction} className="flex flex-col gap-3">
              <input type="hidden" name="visiteId" value={visite.id} />
              <p className="text-[12px] text-text-3">
                Destinataire(s) : {vendeursCanoniques.map((v) => [v.prenom, v.nom].filter(Boolean).join(" ")).join(", ")}
              </p>
              <div>
                <label className="text-[12px] font-medium text-text-2 mb-1 block">Canal</label>
                <select
                  name="canal"
                  defaultValue="appel"
                  className="border border-border-md rounded-lg px-2 py-1.5 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                >
                  {(Object.keys(LABEL_TYPE_INTERACTION) as TypeInteraction[]).map((canal) => (
                    <option key={canal} value={canal}>
                      {LABEL_TYPE_INTERACTION[canal]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-text-2 mb-1 block">Note (optionnel)</label>
                <textarea
                  name="note"
                  rows={3}
                  placeholder="Ex. Retour effectué au vendeur après la visite. Acquéreur intéressé mais réserve sur la cuisine."
                  className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>
              <Button type="submit" variant="primary" size="md" className="self-start">
                Enregistrer le retour vendeur
              </Button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
