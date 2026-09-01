import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ruler, DoorOpen, Building, TreePine, Car } from "lucide-react";
import Badge from "@/components/ui/Badge";
import StatTile from "@/components/ui/StatTile";
import BienHero from "@/components/bien/BienHero";
import BienGaleriePhotos from "@/components/bien/BienGaleriePhotos";
import BienStatutAction from "@/components/bien/BienStatutAction";
import BienVendeurMandat from "@/components/bien/BienVendeurMandat";
import BienAcquereursCompatibles from "@/components/bien/BienAcquereursCompatibles";
import BienTabs from "@/components/bien/BienTabs";
import { ongletBienValide } from "@/types/ongletBien";
import { getBienById } from "@/lib/bienRepository";
import { getPhotoPrincipaleBien, listerPhotosBien } from "@/lib/photoBienRepository";
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
import { deriverStatutCommercial, LABEL_STATUT_COMMERCIAL, type StatutCommercial } from "@/lib/statutCommercialBien";

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

// `onglet` (DEMO-DOCS-UX-01) : onglet d'ouverture de la fiche. Permet à une mutation faite
// depuis un onglet d'y ramener l'utilisateur, et à un lien direct/rechargement de rouvrir le bon
// onglet. Absent ou invalide -> "contexte", le défaut historique.
type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> };

export default async function FicheBien({ params, searchParams }: PageProps) {
  const { id } = await params;
  const ongletInitial = ongletBienValide((await searchParams).onglet);
  const bien = await getBienById(id);
  if (!bien) notFound();

  const photoPrincipale = await getPhotoPrincipaleBien(bien.id);
  // Compteur affiché dans le hero + filmstrip galerie (design validé Claude Design, artifact
  // ec9f41b8) — jamais cle_stockage exposé : seuls les id (déjà dans l'ordre déterministe ADR-052,
  // ordre ASC/cree_le ASC/id ASC) traversent la frontière vers BienGaleriePhotos.
  const photosBien = await listerPhotosBien(bien.id);
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

  // Statut affiché dans le hero et le bandeau statut/action — mock (dossier) si présent, sinon
  // dérivé des jalons réels (statutCommercial, ADR-014), exactement comme avant ce chantier.
  const { label: statutAffiche, variant: statutAfficheVariant } = dossier
    ? statutConfig[dossier.statut]
    : { label: LABEL_STATUT_COMMERCIAL[statutCommercial], variant: variantStatutCommercial[statutCommercial] };

  const statutLabelNode = (
    <>
      <Badge variant={statutAfficheVariant}>{statutAffiche}</Badge>
      {bien.archiveLe && <Badge variant="muted">Archivé le {formatDate(bien.archiveLe)}</Badge>}
    </>
  );

  // Dérivé de la tâche prioritaire réelle (tachePriority.ts, inchangé) — vide pour un bien mocké
  // (getTachesPourBien ne retourne rien pour un id non-UUID), pas une régression de ce chantier.
  const raisonTacheTexte = tachePrincipale ? raisonTache(tachePrincipale) : undefined;
  const prochaineVisiteHref = prochaineVisite ? `/visites/${prochaineVisite.id}/preparer` : undefined;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      {/* Retour */}
      <Link
        href="/biens"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Biens
      </Link>

      {/* Hero — design validé Claude Design (artifact 7615625f) : photo réelle prioritaire (ADR-052,
          via photoPrincipaleId/PhotoPrincipale, jamais de seconde logique de galerie), statut et
          prix en overlay, cohérent avec le traitement déjà validé sur la Liste Biens. */}
      <div className="mb-6">
        <BienHero
          bien={bien}
          photoPrincipaleId={photoPrincipale?.id}
          nombrePhotos={photosBien.length}
          statutCommercialLabel={statutAffiche}
          statutCommercialVariant={statutAfficheVariant}
        />
        {/* bien.titre volontairement non ré-affiché ici (polish visuel) — le Hero porte déjà
            type/pièces et la bande Repères juste en dessous porte déjà surface/pièces : une
            troisième restitution de la même information entre les deux n'apportait rien. La
            valeur réelle du champ n'est pas supprimée du modèle, seulement de cet emplacement. */}
      </div>

      {/* Filmstrip galerie (design validé Claude Design, artifact ec9f41b8) — 0 ou 1 photo : aucun
          filmstrip, jamais un faux état de galerie. Pas de lightbox dans ce chantier (hors
          périmètre) : voir BienGaleriePhotos, chaque vignette renvoie vers la gestion des photos. */}
      {photosBien.length > 1 && (
        <div className="mb-4">
          <BienGaleriePhotos bienId={bien.id} photoIds={photosBien.map((photo) => photo.id)} />
        </div>
      )}

      {/* Repères — uniquement les attributs réellement renseignés sur le Bien, jamais une valeur
          inventée pour compléter la grille. `inline-flex` (au lieu d'un bloc pleine largeur) :
          la carte doit se contracter à son contenu réel (parfois seulement 2 tuiles) plutôt que
          laisser une bande blanche disproportionnée sur un Bien peu renseigné, tout en restant
          capable de s'élargir naturellement dès que plus de champs/caractéristiques existent. */}
      <div className="inline-flex flex-col max-w-full bg-surface border border-border-subtle rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] px-4 py-3.5 md:px-5 mb-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
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
        {/* Caractéristiques (design validé Claude Design, artifact ec9f41b8) — extrait de
            bien.caracteristiques (déjà chargé, jusque-là visible seulement dans l'onglet Contexte,
            inchangé). Plafonné à 3 pour rester une bande de repères, jamais un remplacement : la
            liste complète reste dans l'onglet Contexte. Jamais affiché si le tableau est vide.
            Libellé volontairement distinct de « Points forts » : ce terme désigne déjà, ailleurs
            dans le produit (src/lib/pointsForts/moteur.ts, page Préparer une visite), un bonus
            Bien × Acquéreur relatif aux critères d'un acquéreur précis — un concept différent de
            cette liste de caractéristiques brutes du bien, jamais réutilisé ici pour ne pas créer
            d'ambiguïté entre les deux. */}
        {bien.caracteristiques.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap border-t border-border-subtle mt-3.5 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted shrink-0">
              Caractéristiques
            </span>
            <div className="flex flex-wrap gap-1.5">
              {bien.caracteristiques.slice(0, 3).map((caracteristique) => (
                <span
                  key={caracteristique}
                  className="text-[12px] text-text-secondary bg-surface-subtle border border-border-subtle rounded-full px-2.5 py-1"
                >
                  {caracteristique}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-4">
        <BienStatutAction
          bien={bien}
          statutLabel={statutLabelNode}
          raisonTacheTexte={raisonTacheTexte}
          dateMandatFormatee={dateMandat}
          prochaineVisiteHref={prochaineVisiteHref}
        />
      </div>

      <div className="mb-4">
        <BienVendeurMandat bien={bien} prospectVendeurOrigine={prospectVendeurOrigine} />
      </div>

      <div className="mb-8">
        <BienAcquereursCompatibles compatibilites={compatibilites} acquereursActifs={acquereursActifs} />
      </div>

      {/* Onglets — Contexte, Notes, Visites, Documents et Tâches sont tous réels (voir BienTabs,
          aucun DossierBien artificiel fabriqué ici). Structure de navigation de BienTabs inchangée
          dans ce chantier (canvas ec9f41b8) : Contexte reste le premier onglet, aucun regroupement/
          renommage — la consolidation en ancres explorée séparément est hors périmètre ici.
          Acquéreurs compatibles n'est plus un onglet, voir BienAcquereursCompatibles ci-dessus. */}
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
        ongletInitial={ongletInitial}
      />
    </div>
  );
}
