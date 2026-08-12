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
import { getActionsPourBien, getActionsPourAcquereur } from "@/lib/actionRepository";
import { listerNotesPourBien } from "@/lib/noteBienRepository";
import { listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import {
  selectionnerActionsEnCours,
  selectionnerComptesRendusRecents,
  selectionnerHistoriqueRecent,
} from "@/lib/memoireDossier";
import { enregistrerCompteRenduVisiteAction } from "@/actions/enregistrerCompteRenduVisite";
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
      className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
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
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-2">
          {rdv.titre}
        </h1>
        <p className="text-[14px] text-[#64748b] leading-relaxed">
          Atlas n'a pas pu identifier avec une confiance suffisante le bien et/ou l'acquéreur
          concernés par ce rendez-vous — aucune préparation ne peut être affichée de façon fiable.
        </p>
      </div>
    );
  }

  const bien = await getBienById(contexte.bien.bienId);
  const acquereur = await getClientById(contexte.client.clientId);
  if (!bien || !acquereur) notFound();

  // Mémoire du dossier — uniquement ce que le conseiller a déjà lui-même enregistré (comptes
  // rendus, notes, actions), jamais interprété ni résumé. N'alimente ni pointsAttention ni
  // pointsForts.
  const [actionsDuBien, actionsDeLAcquereur, notesDuBien, comptesRendusDuBien] = await Promise.all([
    getActionsPourBien(bien.id),
    getActionsPourAcquereur(acquereur.id),
    listerNotesPourBien(bien.id),
    listerComptesRendusPourBien(bien.id),
  ]);
  const notesRecentes = notesDuBien.slice(0, 3);
  const actionsEnCours = selectionnerActionsEnCours(actionsDuBien, actionsDeLAcquereur);
  const historiqueRecent = selectionnerHistoriqueRecent(actionsDuBien);
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
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="accent">Préparation de visite</Badge>
          <span className="text-[13px] text-[#94a3b8]">{prep.heureVisite}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mt-2">
          {bien.titre}
        </h1>
        <p className="text-[14px] text-[#64748b] mt-0.5">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <span className="text-[15px] font-semibold text-[#0f172a]">{formatPrix(bien.prix)}</span>
          <span className="text-[13px] text-[#94a3b8]">{bien.surface} m² · {bien.pieces} pièces</span>
        </div>
        {localisation && qualiteGeocodage === "fiable" && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            Localisation : {localisation.coordonnees.lat.toFixed(5)}, {localisation.coordonnees.lon.toFixed(5)}
            {" — "}
            {localisation.labelTrouve} (confiance {Math.round(localisation.score * 100)}%) · IGN Géoplateforme
          </p>
        )}
        {localisation && qualiteGeocodage !== "fiable" && (
          <div className="mt-3 bg-[#fef2f2] rounded-lg p-3">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-[#dc2626] mb-1">
              {qualiteGeocodage === "a_verifier" ? "Adresse à vérifier" : "Adresse non fiable"}
            </p>
            <p className="text-[13px] text-[#64748b] leading-snug">
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
              <div key={p.id} className="bg-[#fef2f2] rounded-lg px-4 py-3">
                <p className="text-[14px] text-[#0f172a] leading-snug">{p.texte}</p>
                <p className="text-[11px] text-[#94a3b8] mt-1">{p.provenance}</p>
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
              <div key={p.id} className="bg-[#f0fdf4] rounded-lg px-4 py-3">
                <p className="text-[14px] text-[#0f172a] leading-snug">{p.texte}</p>
                <p className="text-[11px] text-[#94a3b8] mt-1">{p.provenance}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Profil acquéreur */}
      <section className="mb-8 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
        <SectionTitle>Acquéreur</SectionTitle>
        <p className="text-[15px] font-medium text-[#0f172a]">
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
              <span key={c} className="text-[12px] bg-[#f8f9fa] text-[#64748b] px-2 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
        )}
        {aq.notes && (
          <p className="text-[13px] text-[#94a3b8] mt-3 leading-relaxed border-t border-[#f1f5f9] pt-3">
            {aq.notes}
          </p>
        )}
      </section>

      {/* Mémoire du dossier — uniquement ce que le conseiller a déjà lui-même enregistré (comptes
          rendus, notes, actions). Jamais résumé, jamais interprété, aucune écriture possible
          depuis cette section (le formulaire d'enregistrement est plus bas, séparé). */}
      {(comptesRendusRecents.length > 0 ||
        notesRecentes.length > 0 ||
        actionsEnCours.length > 0 ||
        historiqueRecent.length > 0) && (
        <section className="mb-8">
          <SectionTitle>Mémoire du dossier</SectionTitle>

          {comptesRendusRecents.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
                Comptes rendus précédents avec {aq.prenom} {aq.nom}
              </p>
              <div className="flex flex-col gap-2">
                {comptesRendusRecents.map((cr) => (
                  <div key={cr.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-[11px] text-[#94a3b8]">{formatDateCourte(cr.dateVisite)}</p>
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
                    <p className="text-[14px] text-[#0f172a] leading-relaxed whitespace-pre-wrap">
                      {cr.retour}
                    </p>
                    {cr.prochaineEtape && (
                      <p className="text-[13px] text-[#94a3b8] mt-2 border-t border-[#f1f5f9] pt-2">
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
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
                Notes récentes
              </p>
              <div className="flex flex-col gap-2">
                {notesRecentes.map((note) => (
                  <div key={note.id} className="bg-white rounded-lg border border-[#f1f5f9] p-4">
                    <p className="text-[11px] text-[#94a3b8] mb-1">{formatDateCourte(note.creeLe)}</p>
                    {note.contenu.length > APERCU_NOTE_MAX ? (
                      <details>
                        <summary className="text-[14px] text-[#0f172a] leading-relaxed cursor-pointer">
                          {apercuNote(note.contenu)}{" "}
                          <span className="text-[12px] text-[#4338ca] font-medium">Lire la suite</span>
                        </summary>
                        <p className="text-[14px] text-[#0f172a] leading-relaxed mt-2 whitespace-pre-wrap">
                          {note.contenu}
                        </p>
                      </details>
                    ) : (
                      <p className="text-[14px] text-[#0f172a] leading-relaxed whitespace-pre-wrap">
                        {note.contenu}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {actionsEnCours.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
                Actions en cours
              </p>
              <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9]">
                {actionsEnCours.map((action) => (
                  <div key={action.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={action.origine === "bien" ? "accent" : "default"}>
                        {action.origine === "bien" ? "Bien" : "Acquéreur"}
                      </Badge>
                      <p className="text-[14px] text-[#0f172a]">{action.titre}</p>
                    </div>
                    {action.contexte && (
                      <p className="text-[13px] text-[#94a3b8] mt-0.5">{action.contexte}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {historiqueRecent.length > 0 && (
            <details>
              <summary className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] cursor-pointer">
                Historique récent ({historiqueRecent.length})
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                {historiqueRecent.map((evt) => (
                  <p key={`${evt.date}-${evt.texte}`} className="text-[13px] text-[#64748b]">
                    <span className="text-[#94a3b8]">{formatDateCourte(evt.date)}</span> — {evt.texte}
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
        <p className="text-[14px] text-[#64748b] leading-relaxed">{bien.description}</p>
      </section>

      {/* Marché — transactions réelles à proximité, jamais une estimation */}
      {marcheDvf && marcheDvf.transactions.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Marché</SectionTitle>
          <p className="text-[13px] text-[#94a3b8] mb-3 leading-relaxed">
            Transactions de vente réellement enregistrées à proximité, de surface comparable — des
            références de marché pour le conseiller, pas une estimation du bien.
          </p>

          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-3">
            <p className="text-[11px] text-[#94a3b8] uppercase tracking-wider">Prix affiché de ce bien</p>
            <p className="text-[16px] font-semibold text-[#4338ca] mt-0.5">
              {formatPrixM2(Math.round(bien.prix / bien.surface))}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {marcheDvf.transactions.map((t) => (
              <div
                key={t.reference}
                className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#64748b]">
                    {t.surfaceM2.toFixed(0)} m² · {t.distanceMetres} m
                  </p>
                  <p className="text-[11px] text-[#94a3b8] mt-0.5">
                    Vendu le{" "}
                    {new Date(t.dateVente).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-medium text-[#0f172a]">{formatPrix(t.prixVente)}</p>
                  <p className="text-[11px] text-[#94a3b8]">{formatPrixM2(t.prixM2)}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#94a3b8] mt-2">
            Source : {marcheDvf.source} · récupéré le {new Date(marcheDvf.recupereLe).toLocaleString("fr-FR")}
          </p>
        </section>
      )}

      {/* Questions suggérées — aide au conseiller, pas une donnée factuelle sur le bien/l'acquéreur */}
      {prep.questionsASuggerer && prep.questionsASuggerer.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Questions suggérées pour la visite</SectionTitle>
          <p className="text-[13px] text-[#94a3b8] mb-3 leading-relaxed">
            Une aide pour préparer l'entretien — pas une information sur le bien ou l'acquéreur.
          </p>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9]">
            {prep.questionsASuggerer.map((q, i) => (
              <p key={i} className="py-3 text-[14px] text-[#0f172a] leading-snug">
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

      {/* Compte rendu après la visite — jamais de génération automatique d'action ; la
          "prochaine étape" reste un texte libre, à transformer manuellement en action si besoin
          via le bouton "+ Ajouter une action" existant sur la fiche du bien. */}
      <section className="mb-8 border-t border-[#f1f5f9] pt-6">
        <SectionTitle>Compte rendu de la visite</SectionTitle>
        {bien.archiveLe || acquereur.archiveLe ? (
          <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
            {bien.archiveLe && acquereur.archiveLe
              ? "Ce bien et cet acquéreur sont archivés"
              : bien.archiveLe
                ? "Ce bien est archivé"
                : "Cet acquéreur est archivé"}{" "}
            — impossible d'ajouter un nouveau compte rendu.
          </p>
        ) : (
        <form action={enregistrerCompteRenduVisiteAction} className="flex flex-col gap-4">
          <input type="hidden" name="bienId" value={bien.id} />
          <input type="hidden" name="acquereurId" value={acquereur.id} />

          <div>
            <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Date de la visite</label>
            <input
              type="date"
              name="dateVisite"
              defaultValue={dateVisiteParDefaut}
              required
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Intérêt de l'acquéreur</label>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(LABEL_INTERET) as Interet[]).map((valeur) => (
                <label key={valeur} className="inline-flex items-center gap-1.5 text-[13px] text-[#0f172a]">
                  <input type="radio" name="interet" value={valeur} defaultChecked={valeur === "inconnu"} />
                  {LABEL_INTERET[valeur]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-[#64748b] mb-1 block">Retour libre</label>
            <textarea
              name="retour"
              rows={4}
              required
              placeholder="Ce que vous avez observé, ce que l'acquéreur a dit..."
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[#64748b] mb-1 block">
              Prochaine étape (optionnel)
            </label>
            <textarea
              name="prochaineEtape"
              rows={2}
              placeholder="Ex. Envoyer une contre-proposition, relancer dans une semaine..."
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </div>

          <button
            type="submit"
            className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-4 py-2.5 rounded-lg"
          >
            Enregistrer le compte rendu
          </button>
        </form>
        )}
      </section>

      {/* Rappel du principe Atlas */}
      <p className="text-[12px] text-[#94a3b8] leading-relaxed border-t border-[#f1f5f9] pt-4 mb-6">
        Ces éléments sont des suggestions pour vous aider à préparer la visite — ils ne remplacent ni
        votre jugement, ni la relation que vous construisez avec l'acquéreur.
      </p>
    </div>
  );
}
