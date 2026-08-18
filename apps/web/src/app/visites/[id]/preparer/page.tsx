import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import VieAutourDuBien from "@/components/visite/VieAutourDuBien";
import PatrimoineEtHistoire from "@/components/visite/PatrimoineEtHistoire";
import { getPreparationPourBienEtClient } from "@/data/preparations";
import { getRendezVousAvecContexte } from "@/lib/rendezVousContexte";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getTachesPourBien, getTachesPourAcquereur } from "@/lib/tacheRepository";
import { listerNotesPourBien } from "@/lib/noteBienRepository";
import { listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import {
  selectionnerActionsEnCours,
  selectionnerComptesRendusRecents,
  selectionnerHistoriqueRecent,
} from "@/lib/memoireDossier";
import { enregistrerCompteRenduVisiteAction } from "@/actions/enregistrerCompteRenduVisite";
import { annulerVisiteAction, materialiserVisiteAction, reporterVisiteAction } from "@/actions/visite";
import { getVisiteParRendezVousCalendarId } from "@/lib/visiteRepository";
import { LABEL_STATUT_VISITE, type Visite } from "@/types/visite";
import { LABEL_INTERET, type Interet } from "@/types/compteRenduVisite";
import { formatDateISO } from "@/lib/temps";
import { geocoderAdresse } from "@/lib/geocodage/ignClient";
import { evaluerQualiteGeocodage } from "@/lib/geocodage/qualite";
import { rechercherArretsProches } from "@/lib/transports/primClient";
import { rechercherVelibProches } from "@/lib/transports/velibClient";
import { rechercherEcolesProches } from "@/lib/ecoles/annuaireEducationClient";
import type { EtablissementProche } from "@/types/ecoles";
import { rechercherCommercesProches } from "@/lib/commerces/overpassClient";
import { rechercherPatrimoineProche } from "@/lib/patrimoine/merimeeClient";
import { selectionnerElementsARaconter } from "@/lib/araconter/selectionMerimee";
import { rechercherTransactionsComparables } from "@/lib/marche/dvfClient";
import { produirePointsAttention } from "@/lib/pointsAttention/moteur";
import { produirePointsForts } from "@/lib/pointsForts/moteur";
import type { PreparationVisite } from "@/types/preparation";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { RendezVous } from "@/types/agenda";

type PageProps = { params: Promise<{ id: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VARIANT_BADGE_STATUT_VISITE = {
  planifiee: "accent",
  realisee: "success",
  annulee: "muted",
} as const;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatPrixM2(prixM2: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prixM2) + "/m²";
}

function formatDateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Aperçu court avant le <details>/<summary> natif — pas de troncature définitive : le texte
// complet reste toujours accessible en un clic, sans JS.
const APERCU_NOTE_MAX = 140;
function apercuNote(contenu: string): string {
  return contenu.length > APERCU_NOTE_MAX ? `${contenu.slice(0, APERCU_NOTE_MAX).trimEnd()}…` : contenu;
}

const stadeLabel: Record<string, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

// Utilisée quand aucune préparation curatée n'existe pour ce couple bien/acquéreur : uniquement
// des faits réels (bien, acquéreur, rendez-vous), aucune section qualitative inventée.
function construirePreparationMinimale(rdv: RendezVous, bien: Bien, acquereur: ProfilAcquereur): PreparationVisite {
  return {
    id: `contexte-${rdv.id}`,
    bien,
    acquereur,
    dateVisite: rdv.date ?? formatDateISO(new Date()),
    heureVisite: rdv.heure,
    resumeBien: bien.description,
  };
}

function EnTeteRetour() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
    >
      <ArrowLeft size={14} />
      Aujourd'hui
    </Link>
  );
}

export default async function PreparerVisite({ params }: PageProps) {
  const { id } = await params;
  const resultat = await getRendezVousAvecContexte(id);
  if (!resultat) notFound();

  const { rdv, contexte } = resultat;

  if (!contexte.bien || !contexte.client) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
        <EnTeteRetour />
        <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-2">
          {rdv.titre}
        </h1>
        <p className="text-[14px] text-text-2 leading-relaxed">
          Atlas n'a pas pu identifier avec une confiance suffisante le bien et/ou l'acquéreur
          concernés par ce rendez-vous — aucune préparation ne peut être affichée de façon fiable.
        </p>
      </div>
    );
  }

  const bien = await getBienById(contexte.bien.bienId);
  const acquereur = await getClientById(contexte.client.clientId);
  if (!bien || !acquereur) notFound();

  // Lecture seule (ADR-041, correction du défaut GET-mutant d'ADR-040) : cette page ne matérialise
  // plus jamais de Visite Atlas dans son propre rendu — un GET (navigation, rafraîchissement,
  // aperçu de lien, prefetch éventuel) reste sans aucun effet de bord métier. Aucun fallback mock :
  // si bien/acquéreur ne sont pas de vrais UUID persistés, aucune visite ne pourra jamais exister
  // pour ce rendez-vous — comportement identique à avant ADR-040 dans ce cas.
  const visite: Visite | undefined =
    UUID_REGEX.test(bien.id) && UUID_REGEX.test(acquereur.id)
      ? await getVisiteParRendezVousCalendarId(rdv.id)
      : undefined;

  // Aucune Visite Atlas matérialisée pour ce rendez-vous pourtant résolu sans ambiguïté : plutôt
  // que d'engager silencieusement tous les appels externes ci-dessous (géocodage, transports,
  // écoles, patrimoine, marché) pour un rendez-vous que le conseiller n'a peut-être fait
  // qu'entrouvrir, on s'arrête ici avec une action explicite unique — le seul point d'écriture
  // possible désormais (`materialiserVisiteAction`, POST, jamais un GET).
  if (UUID_REGEX.test(bien.id) && UUID_REGEX.test(acquereur.id) && !visite) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
        <EnTeteRetour />
        <div className="mb-6">
          <Badge variant="accent">Rendez-vous résolu</Badge>
          <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mt-2">
            {bien.titre}
          </h1>
          <p className="text-[14px] text-text-2 mt-0.5">
            {bien.adresse}, {bien.codePostal} {bien.ville}
          </p>
          <p className="text-[14px] text-text-1 mt-3">
            Acquéreur : {acquereur.prenom} {acquereur.nom}
          </p>
        </div>
        <form action={materialiserVisiteAction}>
          <input type="hidden" name="rendezVousCalendarId" value={rdv.id} />
          <button
            type="submit"
            className="text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg"
          >
            Enregistrer et préparer cette visite
          </button>
        </form>
      </div>
    );
  }

  // Mémoire du dossier — uniquement ce que le conseiller a déjà lui-même enregistré (comptes
  // rendus, notes, tâches), jamais interprété ni résumé. N'alimente ni pointsAttention ni
  // pointsForts.
  const [tachesDuBien, tachesDeLAcquereur, notesDuBien, comptesRendusDuBien] = await Promise.all([
    getTachesPourBien(bien.id),
    getTachesPourAcquereur(acquereur.id),
    listerNotesPourBien(bien.id),
    listerComptesRendusPourBien(bien.id),
  ]);
  const notesRecentes = notesDuBien.slice(0, 3);
  const tachesEnCours = selectionnerActionsEnCours(tachesDuBien, tachesDeLAcquereur);
  const historiqueRecent = selectionnerHistoriqueRecent(tachesDuBien);
  const comptesRendusRecents = selectionnerComptesRendusRecents(comptesRendusDuBien, acquereur.id);
  const dateVisiteParDefaut = rdv.date ?? formatDateISO(new Date());

  // Géocodage de l'adresse du bien (pas celle du rendez-vous Google, potentiellement
  // différente) — best-effort, aucune coordonnée de repli si l'IGN ne répond pas.
  const adresseBien = `${bien.adresse}, ${bien.codePostal} ${bien.ville}`;
  const localisation = await geocoderAdresse(adresseBien);
  const qualiteGeocodage = localisation ? evaluerQualiteGeocodage(localisation.score) : undefined;

  // Les enrichissements géographiques ne s'exécutent que sur une localisation fiable — une
  // adresse douteuse ne doit jamais servir de base à d'autres appels.
  const [transports, velib, ecoles, commerces, patrimoine, marcheDvf] =
    qualiteGeocodage === "fiable" && localisation
      ? await Promise.all([
          rechercherArretsProches(localisation.coordonnees),
          rechercherVelibProches(localisation.coordonnees),
          rechercherEcolesProches(localisation.coordonnees),
          rechercherCommercesProches(localisation.coordonnees),
          rechercherPatrimoineProche(localisation.coordonnees, bien.codePostal),
          rechercherTransactionsComparables(localisation.coordonnees, bien.type, bien.surface),
        ])
      : [undefined, undefined, undefined, undefined, undefined, undefined];

  // Restaurants/cafés volontairement exclus de l'affichage pour l'instant (récupérés dans
  // `commerces` mais sans signal de pertinence autre que la distance).
  const groupesCommerces: { label: string; items: { nom: string; distanceMetres: number }[] }[] = commerces
    ? [
        { label: "alimentation", items: commerces.alimentation },
        { label: "boulangerie", items: commerces.boulangeries },
        { label: "pharmacie", items: commerces.pharmacies },
        { label: "marché", items: commerces.marches },
        { label: "parc", items: commerces.parcs },
        { label: "équipement sportif", items: commerces.sport },
        { label: "santé", items: commerces.sante },
      ]
    : [];

  const elementsARaconter = patrimoine
    ? selectionnerElementsARaconter(patrimoine.monuments, "Base Mérimée", patrimoine.recupereLe)
    : [];

  const groupesEcoles: { niveau: string; items: EtablissementProche[] }[] = ecoles
    ? [
        { niveau: "École", items: ecoles.ecoles },
        { niveau: "Collège", items: ecoles.colleges },
        { niveau: "Lycée", items: ecoles.lycees },
      ]
    : [];

  const prep =
    getPreparationPourBienEtClient(bien.id, acquereur.id) ?? construirePreparationMinimale(rdv, bien, acquereur);

  const { acquereur: aq } = prep;

  const pointsAttention = produirePointsAttention({ bien, acquereur, transports, velib });
  const pointsForts = produirePointsForts({ bien, acquereur });

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* Retour */}
      <EnTeteRetour />

      {/* En-tête */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant="accent">Préparation de visite</Badge>
          {/* Statut Visite (ADR-040) — absent si la visite n'a pas pu être matérialisée (bien/
              acquéreur mockés) : comportement identique à avant ADR-040 dans ce cas. */}
          {visite && <Badge variant={VARIANT_BADGE_STATUT_VISITE[visite.statut]}>{LABEL_STATUT_VISITE[visite.statut]}</Badge>}
          <span className="text-[13px] text-text-3">{prep.heureVisite}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mt-2">
          {bien.titre}
        </h1>
        <p className="text-[14px] text-text-2 mt-0.5">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <span className="text-[15px] font-semibold text-text-1">{formatPrix(bien.prix)}</span>
          <span className="text-[13px] text-text-3">{bien.surface} m² · {bien.pieces} pièces</span>
        </div>
        {localisation && qualiteGeocodage === "fiable" && (
          <p className="text-[12px] text-text-3 mt-2">
            Localisation : {localisation.coordonnees.lat.toFixed(5)}, {localisation.coordonnees.lon.toFixed(5)}
            {" — "}
            {localisation.labelTrouve} (confiance {Math.round(localisation.score * 100)}%) · IGN Géoplateforme
          </p>
        )}
        {localisation && qualiteGeocodage !== "fiable" && (
          <div className="mt-3 bg-danger-light rounded-lg p-3">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-danger mb-1">
              {qualiteGeocodage === "a_verifier" ? "Adresse à vérifier" : "Adresse non fiable"}
            </p>
            <p className="text-[13px] text-text-2 leading-snug">
              Atlas a interprété « {adresseBien} » comme « {localisation.labelTrouve} » — confiance{" "}
              {Math.round(localisation.score * 100)}%.
            </p>
          </div>
        )}
      </div>

      {/* Points d'attention pour la visite */}
      {pointsAttention.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Points d'attention pour la visite</SectionTitle>
          <div className="flex flex-col gap-2">
            {pointsAttention.map((p) => (
              <div key={p.id} className="bg-danger-light rounded-lg px-4 py-3">
                <p className="text-[14px] text-text-1 leading-snug">{p.texte}</p>
                <p className="text-[11px] text-text-3 mt-1">{p.provenance}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Points forts pour la visite */}
      {pointsForts.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Points forts pour la visite</SectionTitle>
          <div className="flex flex-col gap-2">
            {pointsForts.map((p) => (
              <div key={p.id} className="bg-success-light rounded-lg px-4 py-3">
                <p className="text-[14px] text-text-1 leading-snug">{p.texte}</p>
                <p className="text-[11px] text-text-3 mt-1">{p.provenance}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Profil acquéreur */}
      <section className="mb-8 bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
        <SectionTitle>Acquéreur</SectionTitle>
        <p className="text-[15px] font-medium text-text-1">
          {aq.prenom} {aq.nom}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="default">{stadeLabel[aq.stadeProjet]}</Badge>
          <Badge variant="muted">
            {formatPrix(aq.budgetMin)} – {formatPrix(aq.budgetMax)}
          </Badge>
        </div>
        {aq.criteres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {aq.criteres.map((c) => (
              <span key={c} className="text-[12px] bg-surface-muted text-text-2 px-2 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
        )}
        {aq.notes && (
          <p className="text-[13px] text-text-3 mt-3 leading-relaxed border-t border-border pt-3">
            {aq.notes}
          </p>
        )}
      </section>

      {/* Mémoire du dossier — uniquement ce que le conseiller a déjà lui-même enregistré (comptes
          rendus, notes, actions). Jamais résumé, jamais interprété, aucune écriture possible
          depuis cette section (le formulaire d'enregistrement est plus bas, séparé). */}
      {(comptesRendusRecents.length > 0 ||
        notesRecentes.length > 0 ||
        tachesEnCours.length > 0 ||
        historiqueRecent.length > 0) && (
        <section className="mb-8">
          <SectionTitle>Mémoire du dossier</SectionTitle>

          {comptesRendusRecents.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                Comptes rendus précédents avec {aq.prenom} {aq.nom}
              </p>
              <div className="flex flex-col gap-2">
                {comptesRendusRecents.map((cr) => (
                  <div key={cr.id} className="bg-surface rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-[11px] text-text-3">{formatDateCourte(cr.dateVisite)}</p>
                      <Badge
                        variant={
                          cr.interet === "interesse"
                            ? "success"
                            : cr.interet === "pas_interesse"
                              ? "muted"
                              : "default"
                        }
                      >
                        {LABEL_INTERET[cr.interet]}
                      </Badge>
                    </div>
                    <p className="text-[14px] text-text-1 leading-relaxed whitespace-pre-wrap">
                      {cr.retour}
                    </p>
                    {cr.prochaineEtape && (
                      <p className="text-[13px] text-text-3 mt-2 border-t border-border pt-2">
                        Prochaine étape : {cr.prochaineEtape}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {notesRecentes.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                Notes récentes
              </p>
              <div className="flex flex-col gap-2">
                {notesRecentes.map((note) => (
                  <div key={note.id} className="bg-surface rounded-lg border border-border p-4">
                    <p className="text-[11px] text-text-3 mb-1">{formatDateCourte(note.creeLe)}</p>
                    {note.contenu.length > APERCU_NOTE_MAX ? (
                      <details>
                        <summary className="text-[14px] text-text-1 leading-relaxed cursor-pointer">
                          {apercuNote(note.contenu)}{" "}
                          <span className="text-[12px] text-accent font-medium">Lire la suite</span>
                        </summary>
                        <p className="text-[14px] text-text-1 leading-relaxed mt-2 whitespace-pre-wrap">
                          {note.contenu}
                        </p>
                      </details>
                    ) : (
                      <p className="text-[14px] text-text-1 leading-relaxed whitespace-pre-wrap">
                        {note.contenu}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tachesEnCours.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                Tâches en cours
              </p>
              <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border">
                {tachesEnCours.map((tache) => (
                  <div key={tache.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={tache.provenance === "bien" ? "accent" : "default"}>
                        {tache.provenance === "bien" ? "Bien" : "Acquéreur"}
                      </Badge>
                      <p className="text-[14px] text-text-1">{tache.titre}</p>
                    </div>
                    {tache.contexte && (
                      <p className="text-[13px] text-text-3 mt-0.5">{tache.contexte}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {historiqueRecent.length > 0 && (
            <details>
              <summary className="text-[11px] font-semibold uppercase tracking-wider text-text-3 cursor-pointer">
                Historique récent ({historiqueRecent.length})
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                {historiqueRecent.map((evt) => (
                  <p key={`${evt.date}-${evt.texte}`} className="text-[13px] text-text-2">
                    <span className="text-text-3">{formatDateCourte(evt.date)}</span> — {evt.texte}
                  </p>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* Résumé du bien */}
      <section className="mb-8">
        <SectionTitle>Résumé du bien</SectionTitle>
        <p className="text-[14px] text-text-2 leading-relaxed">{bien.description}</p>
      </section>

      {/* Marché — transactions réelles à proximité, jamais une estimation */}
      {marcheDvf && marcheDvf.transactions.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Marché</SectionTitle>
          <p className="text-[13px] text-text-3 mb-3 leading-relaxed">
            Transactions de vente réellement enregistrées à proximité, de surface comparable — des
            références de marché pour le conseiller, pas une estimation du bien.
          </p>

          <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-3">
            <p className="text-[11px] text-text-3 uppercase tracking-wider">Prix affiché de ce bien</p>
            <p className="text-[16px] font-semibold text-accent mt-0.5">
              {formatPrixM2(Math.round(bien.prix / bien.surface))}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {marcheDvf.transactions.map((t) => (
              <div
                key={t.reference}
                className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-2">
                    {t.surfaceM2.toFixed(0)} m² · {t.distanceMetres} m
                  </p>
                  <p className="text-[11px] text-text-3 mt-0.5">
                    Vendu le{" "}
                    {new Date(t.dateVente).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-medium text-text-1">{formatPrix(t.prixVente)}</p>
                  <p className="text-[11px] text-text-3">{formatPrixM2(t.prixM2)}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-3 mt-2">
            Source : {marcheDvf.source} · récupéré le {new Date(marcheDvf.recupereLe).toLocaleString("fr-FR")}
          </p>
        </section>
      )}

      {/* Questions suggérées — aide au conseiller, pas une donnée factuelle sur le bien/l'acquéreur */}
      {prep.questionsASuggerer && prep.questionsASuggerer.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Questions suggérées pour la visite</SectionTitle>
          <p className="text-[13px] text-text-3 mb-3 leading-relaxed">
            Une aide pour préparer l'entretien — pas une information sur le bien ou l'acquéreur.
          </p>
          <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border">
            {prep.questionsASuggerer.map((q, i) => (
              <p key={i} className="py-3 text-[14px] text-text-1 leading-snug">
                {q}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Vie pratique autour du bien — Transports + Vélib' + Écoles + Commerces */}
      <VieAutourDuBien
        transports={transports}
        velib={velib}
        ecoles={ecoles}
        groupesEcoles={groupesEcoles}
        commerces={commerces}
        groupesCommerces={groupesCommerces}
      />

      {/* Patrimoine & histoire — Patrimoine à proximité + À raconter si pertinent */}
      <PatrimoineEtHistoire
        monuments={patrimoine?.monuments ?? []}
        recupereLe={patrimoine?.recupereLe}
        elementsARaconter={elementsARaconter}
      />

      {/* Compte rendu après la visite — jamais de génération automatique de tâche ; la
          "prochaine étape" reste un texte libre, à transformer manuellement en tâche si besoin
          via le bouton "+ Ajouter une tâche" existant sur la fiche du bien. */}
      <section className="mb-8 border-t border-border pt-6">
        <SectionTitle>Compte rendu de la visite</SectionTitle>
        {bien.archiveLe || acquereur.archiveLe ? (
          <p className="text-[13px] text-text-3 bg-surface rounded-lg border border-border p-3">
            {bien.archiveLe && acquereur.archiveLe
              ? "Ce bien et cet acquéreur sont archivés"
              : bien.archiveLe
                ? "Ce bien est archivé"
                : "Cet acquéreur est archivé"}{" "}
            — impossible d'ajouter un nouveau compte rendu.
          </p>
        ) : visite && visite.statut !== "planifiee" ? (
          // Visite déjà tranchée (ADR-040) — jamais un second compte rendu ou une seconde
          // transition depuis un état terminal (double soumission, contournement de formulaire).
          <p className="text-[13px] text-text-3 bg-surface rounded-lg border border-border p-3">
            Cette visite a déjà été marquée « {LABEL_STATUT_VISITE[visite.statut]} ».
          </p>
        ) : (
        <>
          {/* Actions de planification (ADR-040) — reporter modifie la même visite (même id,
              jamais annulée+recréée) ; annuler ne demande aucun motif structuré. Absentes si la
              visite n'a pas pu être matérialisée (bien/acquéreur mockés). */}
          {visite && (
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-border">
              <form action={reporterVisiteAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={visite.id} />
                <input type="hidden" name="rendezVousCalendarId" value={rdv.id} />
                <input
                  type="date"
                  name="nouvelleDatePrevue"
                  defaultValue={visite.datePrevue}
                  className="border border-border-md rounded-lg px-2 py-1.5 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
                <button
                  type="submit"
                  className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors"
                >
                  Reporter
                </button>
              </form>
              <form action={annulerVisiteAction}>
                <input type="hidden" name="id" value={visite.id} />
                <input type="hidden" name="rendezVousCalendarId" value={rdv.id} />
                <button
                  type="submit"
                  className="text-[13px] font-medium text-text-2 hover:text-danger transition-colors"
                >
                  Annuler la visite
                </button>
              </form>
            </div>
          )}
        <form action={enregistrerCompteRenduVisiteAction} className="flex flex-col gap-4">
          <input type="hidden" name="bienId" value={bien.id} />
          <input type="hidden" name="acquereurId" value={acquereur.id} />
          <input type="hidden" name="visiteId" value={visite?.id ?? ""} />

          <div>
            <label className="text-[12px] font-medium text-text-2 mb-1 block">Date de la visite</label>
            <input
              type="date"
              name="dateVisite"
              defaultValue={dateVisiteParDefaut}
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
        </>
        )}
      </section>

      {/* Rappel du principe Atlas */}
      <p className="text-[12px] text-text-3 leading-relaxed border-t border-border pt-4 mb-6">
        Ces éléments sont des suggestions pour vous aider à préparer la visite — ils ne remplacent ni
        votre jugement, ni la relation que vous construisez avec l'acquéreur.
      </p>
    </div>
  );
}
