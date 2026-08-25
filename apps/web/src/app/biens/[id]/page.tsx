import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ruler, DoorOpen, Building, TreePine, Car } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PhotoPrincipale from "@/components/bien/PhotoPrincipale";
import StatTile from "@/components/ui/StatTile";
import BienTabs from "@/components/bien/BienTabs";
import { getBienById } from "@/lib/bienRepository";
import { getPhotoPrincipaleBien } from "@/lib/photoBienRepository";
import { getClientById, listerClients } from "@/lib/clientRepository";
import { getDossierByBienId, type StatutDossier } from "@/data/dossier";
import { getTachesPourBien } from "@/lib/tacheRepository";
import { listerNotesPourBien } from "@/lib/noteBienRepository";
import { listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import { listerVisitesPourBien } from "@/lib/visiteRepository";
import { listerDocumentsPourBien } from "@/lib/documentBienRepository";
import { listerOffresPourBien } from "@/lib/offreRepository";
import { listerLiensPourBien } from "@/lib/offreVisiteRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";
import { listerRemunerationsPourBien } from "@/lib/remunerationRepository";
import { listerTransmissionsPourCompromis } from "@/lib/transmissionDossierNotaireRepository";
import { getProspectVendeurParBien } from "@/lib/prospectVendeurRepository";
import { evaluerCompatibiliteBien } from "@/lib/compatibilite/orchestration";
import { LABEL_REGLE_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import { calculerChecklistDossier } from "@/lib/documents/checklistDossier";
import { tachePrioritaire, raisonTache } from "@/lib/tachePriority";
import { rendezVousDuJour } from "@/data/agenda";
import { archiverBienAction, desarchiverBienAction } from "@/actions/archivageBien";
import {
  annulerCompromisAction,
  marquerCompromisSigneAction,
  marquerOffreEnCoursAction,
  retirerOffreAction,
} from "@/actions/statutCommercialBien";
import { deriverStatutCommercial, LABEL_STATUT_COMMERCIAL, type StatutCommercial } from "@/lib/statutCommercialBien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

const statutConfig: Record<StatutDossier, { label: string; variant: "default" | "accent" | "success" }> = {
  en_commercialisation: { label: "En commercialisation", variant: "default" },
  offre_en_cours: { label: "Offre en cours", variant: "accent" },
  compromis_signe: { label: "Compromis signé", variant: "success" },
};

const variantStatutCommercial: Record<StatutCommercial, "default" | "accent" | "success"> = {
  en_commercialisation: "default",
  offre_en_cours: "accent",
  compromis_signe: "success",
  vendu: "success",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function FicheBien({ params }: PageProps) {
  const { id } = await params;
  const bien = await getBienById(id);
  if (!bien) notFound();

  const photoPrincipale = await getPhotoPrincipaleBien(bien.id);
  const dossier = getDossierByBienId(bien.id);
  const taches = await getTachesPourBien(bien.id);
  const notes = await listerNotesPourBien(bien.id);
  const comptesRendus = await listerComptesRendusPourBien(bien.id);
  const visites = await listerVisitesPourBien(bien.id);
  const documents = await listerDocumentsPourBien(bien.id);
  const offres = await listerOffresPourBien(bien.id);
  const liens = await listerLiensPourBien(bien.id);
  const compromis = await listerCompromisPourBien(bien.id);
  const remunerations = await listerRemunerationsPourBien(bien.id);
  // ADR-049 — historique des transmissions notariales, par Compromis (jamais recalculé, snapshot
  // brut restitué tel quel par le repository).
  const transmissionsParCompromis = new Map(
    await Promise.all(compromis.map(async (c) => [c.id, await listerTransmissionsPourCompromis(c.id)] as const))
  );
  const acquereursActifs = await listerClients();
  const compatibilites = await evaluerCompatibiliteBien(bien.id);
  const acquereurIds = [
    ...new Set([
      ...comptesRendus.map((cr) => cr.acquereurId),
      ...offres.map((o) => o.acquereurId),
      ...compromis.map((c) => c.acquereurId),
      ...visites.map((v) => v.acquereurId),
    ]),
  ];
  const acquereurs = await Promise.all(acquereurIds.map((id) => getClientById(id)));
  const acquereursParId = new Map(acquereurIds.map((id, i) => [id, acquereurs[i]]));
  const prospectVendeurOrigine = await getProspectVendeurParBien(bien.id);
  // Contexte du dossier (ADR-029) : le compromis en_cours, sinon le plus récent (garde le contexte
  // d'un dossier déjà réalisé/annulé plutôt que de perdre toute pertinence transaction/financement/
  // notaire dès qu'un compromis change de statut).
  const compromisActuel =
    compromis.find((c) => c.statut === "en_cours") ??
    [...compromis].sort((a, b) => (a.dateSignature < b.dateSignature ? 1 : -1))[0];
  const checklist = calculerChecklistDossier({ bien, compromisActuel, prospectVendeurOrigine }, documents);
  const tachePrincipale = tachePrioritaire(taches);
  const statutCommercial = deriverStatutCommercial(bien, compromis);
  const prochaineVisite = rendezVousDuJour.find(
    (rdv) => rdv.bien?.id === bien.id && rdv.preparationDisponible
  );

  const dateMandat = new Date(bien.dateMandat).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      {/* Retour */}
      <Link
        href="/biens"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Biens
      </Link>

      {/* En-tête du bien — véritable hero immobilier (chantier fidélité visuelle) : média pleine
          largeur, puis informations principales et tuiles métadonnées, plus un header horizontal
          administratif. Layout unique partagé desktop/mobile. */}
      <div className="mb-8">
        <div className="relative w-full h-56 md:h-80 mb-5">
          <PhotoPrincipale
            type={bien.type}
            photoPrincipaleId={photoPrincipale?.id}
            format="hero"
            className="w-full h-full"
          />
          {UUID_REGEX.test(bien.id) && (
            <Link
              href={`/biens/${bien.id}/photos`}
              className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#030a1c]/[0.74] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#030a1c]/[0.9] transition-colors"
            >
              Gérer les photos
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="accent">{bien.reference}</Badge>
          <Badge variant="default">Mandat depuis le {dateMandat}</Badge>
          {bien.archiveLe && <Badge variant="muted">Archivé le {formatDate(bien.archiveLe)}</Badge>}
        </div>
        <h1 className="font-serif text-[24px] md:text-[30px] font-semibold text-text-1 leading-tight">
          {bien.titre}
        </h1>
        <p className="text-[14px] text-text-2 mt-1">
          {bien.adresse}, {bien.codePostal} {bien.ville}
        </p>
        <p className="text-[24px] md:text-[28px] font-semibold text-text-1 mt-3">{formatPrix(bien.prix)}</p>

        {/* Tuiles métadonnées — uniquement les attributs réellement renseignés sur le Bien, jamais
            une valeur inventée pour compléter la grille. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 mt-4 max-w-2xl">
          <StatTile icon={Ruler} valeur={`${bien.surface} m²`} libelle="Surface" />
          <StatTile icon={DoorOpen} valeur={bien.pieces} libelle="Pièces" />
          {bien.etage != null && <StatTile icon={Building} valeur={bien.etage} libelle="Étage" />}
          {bien.exterieur && bien.exterieur !== "aucun" && (
            <StatTile
              icon={TreePine}
              valeur={bien.exterieur === "balcon" ? "Balcon" : bien.exterieur === "terrasse" ? "Terrasse" : "Jardin"}
              libelle="Extérieur"
            />
          )}
          {bien.parking && <StatTile icon={Car} valeur="Oui" libelle="Parking" />}
        </div>

        {/* État du dossier — visible immédiatement. Mock inchangé si dossier existe ; sinon dérivé
            des jalons réels offreEnCoursLe/compromisSigneLe (ADR-014), sans "dernière activité"
            (aucune donnée équivalente réelle pour l'instant). */}
        {dossier ? (
          <div className="mt-4 bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statutConfig[dossier.statut].variant}>
                {statutConfig[dossier.statut].label}
              </Badge>
              <span className="text-[12px] text-text-3">
                Dernière activité le {formatDate(dossier.derniereActivite)}
              </span>
            </div>
            {tachePrincipale && (
              <p className="text-[14px] text-text-1 leading-snug mt-2">{raisonTache(tachePrincipale)}</p>
            )}
          </div>
        ) : (
          <div className="mt-4 bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={variantStatutCommercial[statutCommercial]}>
                {LABEL_STATUT_COMMERCIAL[statutCommercial]}
              </Badge>
            </div>
            {tachePrincipale && (
              <p className="text-[14px] text-text-1 leading-snug mt-2">{raisonTache(tachePrincipale)}</p>
            )}
            {UUID_REGEX.test(bien.id) && !bien.archiveLe && (
              <div className="flex flex-wrap gap-3 mt-3">
                {!bien.offreEnCoursLe && (
                  <form action={marquerOffreEnCoursAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <Button type="submit" variant="primary" size="sm">
                      Marquer une offre en cours
                    </Button>
                  </form>
                )}
                {bien.offreEnCoursLe && !bien.compromisSigneLe && (
                  <form action={retirerOffreAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Retirer l'offre
                    </Button>
                  </form>
                )}
                {!bien.compromisSigneLe && (
                  <form action={marquerCompromisSigneAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Marquer compromis signé
                    </Button>
                  </form>
                )}
                {bien.compromisSigneLe && (
                  <form action={annulerCompromisAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Annuler le compromis
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-4">
          {prochaineVisite && (
            <Link
              href={`/visites/${prochaineVisite.id}/preparer`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg"
            >
              Préparer une visite →
            </Link>
          )}
          {!bien.archiveLe && (
            <Link
              href={`/taches/nouveau?bienId=${bien.id}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3.5 py-2 rounded-lg"
            >
              + Ajouter une tâche
            </Link>
          )}
          {UUID_REGEX.test(bien.id) && (
            <>
              <Link
                href={`/biens/${bien.id}/modifier`}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3.5 py-2 rounded-lg"
              >
                Modifier
              </Link>
              <form action={bien.archiveLe ? desarchiverBienAction : archiverBienAction}>
                <input type="hidden" name="id" value={bien.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 bg-surface border border-border-md hover:border-danger hover:text-danger transition-colors px-3.5 py-2 rounded-lg"
                >
                  {bien.archiveLe ? "Désarchiver" : "Archiver"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Onglets — Contexte, Notes, Visites, Documents et Tâches sont tous réels (voir BienTabs,
          aucun DossierBien artificiel fabriqué ici). */}
      <BienTabs
        bien={bien}
        dossier={dossier}
        taches={taches}
        notes={notes}
        comptesRendus={comptesRendus}
        visites={visites}
        documents={documents}
        offres={offres}
        compromis={compromis}
        remunerations={remunerations}
        transmissionsParCompromis={transmissionsParCompromis}
        liens={liens}
        acquereursActifs={acquereursActifs}
        acquereursParId={acquereursParId}
        compromisActuel={compromisActuel}
        prospectVendeurOrigine={prospectVendeurOrigine}
        checklist={checklist}
        labelRegleAutomatisation={LABEL_REGLE_AUTOMATISATION}
        compatibilites={compatibilites}
      />
    </div>
  );
}
