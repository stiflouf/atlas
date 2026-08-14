import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import BienTabs from "@/components/bien/BienTabs";
import { getBienById } from "@/lib/bienRepository";
import { getClientById, listerClients } from "@/lib/clientRepository";
import { getDossierByBienId, type StatutDossier } from "@/data/dossier";
import { getTachesPourBien } from "@/lib/tacheRepository";
import { listerNotesPourBien } from "@/lib/noteBienRepository";
import { listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import { listerDocumentsPourBien } from "@/lib/documentBienRepository";
import { listerOffresPourBien } from "@/lib/offreRepository";
import { listerLiensPourBien } from "@/lib/offreVisiteRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";
import { listerRemunerationsPourBien } from "@/lib/remunerationRepository";
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

  const dossier = getDossierByBienId(bien.id);
  const taches = await getTachesPourBien(bien.id);
  const notes = await listerNotesPourBien(bien.id);
  const comptesRendus = await listerComptesRendusPourBien(bien.id);
  const documents = await listerDocumentsPourBien(bien.id);
  const offres = await listerOffresPourBien(bien.id);
  const liens = await listerLiensPourBien(bien.id);
  const compromis = await listerCompromisPourBien(bien.id);
  const remunerations = await listerRemunerationsPourBien(bien.id);
  const acquereursActifs = await listerClients();
  const compatibilites = await evaluerCompatibiliteBien(bien.id);
  const acquereurIds = [
    ...new Set([
      ...comptesRendus.map((cr) => cr.acquereurId),
      ...offres.map((o) => o.acquereurId),
      ...compromis.map((c) => c.acquereurId),
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
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* Retour */}
      <Link
        href="/biens"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Biens
      </Link>

      {/* En-tête du bien */}
      <div className="mb-8">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-[#eef2ff] flex items-center justify-center shrink-0 mt-0.5">
            <Building2 size={18} className="text-[#4338ca]" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight">
              {bien.titre}
            </h1>
            <p className="text-[14px] text-[#64748b] mt-0.5">
              {bien.adresse}, {bien.codePostal} {bien.ville}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <span className="text-[20px] font-semibold text-[#0f172a]">{formatPrix(bien.prix)}</span>
          <span className="text-[14px] text-[#64748b]">{bien.surface} m²</span>
          <span className="text-[14px] text-[#94a3b8]">·</span>
          <span className="text-[14px] text-[#64748b]">{bien.pieces} pièces</span>
          <Badge variant="accent">{bien.reference}</Badge>
          <Badge variant="default">Mandat depuis le {dateMandat}</Badge>
          {bien.archiveLe && <Badge variant="muted">Archivé le {formatDate(bien.archiveLe)}</Badge>}
        </div>

        {/* État du dossier — visible immédiatement. Mock inchangé si dossier existe ; sinon dérivé
            des jalons réels offreEnCoursLe/compromisSigneLe (ADR-014), sans "dernière activité"
            (aucune donnée équivalente réelle pour l'instant). */}
        {dossier ? (
          <div className="mt-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statutConfig[dossier.statut].variant}>
                {statutConfig[dossier.statut].label}
              </Badge>
              <span className="text-[12px] text-[#94a3b8]">
                Dernière activité le {formatDate(dossier.derniereActivite)}
              </span>
            </div>
            {tachePrincipale && (
              <p className="text-[14px] text-[#0f172a] leading-snug mt-2">{raisonTache(tachePrincipale)}</p>
            )}
          </div>
        ) : (
          <div className="mt-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={variantStatutCommercial[statutCommercial]}>
                {LABEL_STATUT_COMMERCIAL[statutCommercial]}
              </Badge>
            </div>
            {tachePrincipale && (
              <p className="text-[14px] text-[#0f172a] leading-snug mt-2">{raisonTache(tachePrincipale)}</p>
            )}
            {UUID_REGEX.test(bien.id) && !bien.archiveLe && (
              <div className="flex flex-wrap gap-3 mt-3">
                {!bien.offreEnCoursLe && (
                  <form action={marquerOffreEnCoursAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <button type="submit" className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
                      Marquer une offre en cours
                    </button>
                  </form>
                )}
                {bien.offreEnCoursLe && !bien.compromisSigneLe && (
                  <form action={retirerOffreAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <button type="submit" className="text-[12px] font-medium text-[#64748b] hover:text-[#dc2626] transition-colors">
                      Retirer l'offre
                    </button>
                  </form>
                )}
                {!bien.compromisSigneLe && (
                  <form action={marquerCompromisSigneAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <button type="submit" className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
                      Marquer compromis signé
                    </button>
                  </form>
                )}
                {bien.compromisSigneLe && (
                  <form action={annulerCompromisAction}>
                    <input type="hidden" name="id" value={bien.id} />
                    <button type="submit" className="text-[12px] font-medium text-[#64748b] hover:text-[#dc2626] transition-colors">
                      Annuler le compromis
                    </button>
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
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
            >
              Préparer une visite →
            </Link>
          )}
          {!bien.archiveLe && (
            <Link
              href={`/taches/nouveau?bienId=${bien.id}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4338ca] bg-white border border-[#e2e8f0] hover:border-[#4338ca] transition-colors px-3.5 py-2 rounded-lg"
            >
              + Ajouter une tâche
            </Link>
          )}
          {UUID_REGEX.test(bien.id) && (
            <>
              <Link
                href={`/biens/${bien.id}/modifier`}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4338ca] bg-white border border-[#e2e8f0] hover:border-[#4338ca] transition-colors px-3.5 py-2 rounded-lg"
              >
                Modifier
              </Link>
              <form action={bien.archiveLe ? desarchiverBienAction : archiverBienAction}>
                <input type="hidden" name="id" value={bien.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#64748b] bg-white border border-[#e2e8f0] hover:border-[#dc2626] hover:text-[#dc2626] transition-colors px-3.5 py-2 rounded-lg"
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
        documents={documents}
        offres={offres}
        compromis={compromis}
        remunerations={remunerations}
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
