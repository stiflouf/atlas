import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Card from "@/components/ui/Card";
import PlanifierVisiteForm, { type ChoixPlanification, type GroupeOptionsPlanification } from "@/components/visite/PlanifierVisiteForm";
import { getBienDuWorkspace, listerBiensActifsDuWorkspace } from "@/lib/bienRepository";
import { getAcquereurDuWorkspace, listerAcquereursActifsDuWorkspace } from "@/lib/clientRepository";
import { evaluerCompatibiliteAcquereur, evaluerCompatibiliteBien } from "@/lib/compatibilite/orchestration";
import { LABEL_STATUT_COMPATIBILITE, type ResultatCompatibilite, type StatutCompatibilite } from "@/lib/compatibilite/types";
import { nomComplet } from "@/lib/identite/nomPersonne";
import { formatDateISO } from "@/lib/temps";
import { lienRetourFicheVisite, retourVisiteValide } from "@/lib/visites/retourVisite";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";

// Une requête Postgres seule n'empêche pas la génération statique (même patron que /offres/nouveau).
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ bienId?: string; acquereurId?: string; retour?: string }> };

const ORDRE_GROUPES: StatutCompatibilite[] = ["compatible", "a_verifier", "incompatible"];

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function optionBien(bien: Bien) {
  return { id: bien.id, label: bien.titre, detail: `${bien.ville} · ${formatPrix(bien.prix)}` };
}

function optionAcquereur(acquereur: ProfilAcquereur) {
  return { id: acquereur.id, label: nomComplet(acquereur), detail: `${formatPrix(acquereur.budgetMin)} – ${formatPrix(acquereur.budgetMax)}` };
}

// Groupes d'options ordonnés par statut de compatibilité (compatibles d'abord, puis à vérifier,
// puis incompatibles — jamais masqués : choisir malgré le statut reste possible, le statut est dit).
// Réutilise les résultats du moteur existant (ADR-034), jamais un second calcul ni un score.
function grouperParCompatibilite<T extends { id: string }>(
  candidats: T[],
  compatibilites: ResultatCompatibilite[],
  cle: "bienId" | "acquereurId",
  versOption: (c: T) => { id: string; label: string; detail?: string }
): GroupeOptionsPlanification[] {
  const statutParId = new Map(compatibilites.map((r) => [r[cle], r.statutGlobal]));
  const groupes = ORDRE_GROUPES.map((statut) => ({
    label: LABEL_STATUT_COMPATIBILITE[statut],
    options: candidats.filter((c) => statutParId.get(c.id) === statut).map(versOption),
  }));
  const sansStatut = candidats.filter((c) => !statutParId.has(c.id)).map(versOption);
  if (sansStatut.length > 0) groupes.push({ label: "Autres", options: sansStatut });
  return groupes;
}

// VISIT_NATIVE_ENTRY_V1 — route unique de planification d'une Visite native, atteinte depuis la
// fiche Bien (`?bienId=`), la fiche Acquéreur (`?acquereurId=`) ou un match (les deux). Les query
// params ne sont jamais des faits : chaque id est résolu DANS LE WORKSPACE DE SESSION
// (`exigerWorkspaceCourant`, jamais un workspace lu depuis la requête) ; une entité d'un autre
// workspace est introuvable — ni libellé, ni existence rendus — et les listes de choix sont des
// lecteurs SQL scopés (jamais une liste globale filtrée en JS). `creerVisiteAction` revalide tout
// (workspace, archivage) avant d'écrire. Aucune dépendance Google Calendar : la Visite naît dans
// DOMIORA et s'ouvre sur /visites/{id}.
export default async function NouvelleVisitePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const workspaceId = await exigerWorkspaceCourant();
  const retour = retourVisiteValide(params.retour);
  const [bienFixe, acquereurFixe] = await Promise.all([
    params.bienId ? getBienDuWorkspace(params.bienId, workspaceId) : undefined,
    params.acquereurId ? getAcquereurDuWorkspace(params.acquereurId, workspaceId) : undefined,
  ]);
  const bienValide = bienFixe && !bienFixe.archiveLe ? bienFixe : undefined;
  const acquereurValide = acquereurFixe && !acquereurFixe.archiveLe ? acquereurFixe : undefined;

  // Les compatibilités (moteur ADR-034, inchangé) ne servent qu'à ORDONNER les candidats déjà
  // scopés : un résultat portant un id hors workspace n'a aucun candidat à ordonner, rien n'en sort.
  const bien: ChoixPlanification = bienValide
    ? { mode: "fixe", option: optionBien(bienValide) }
    : {
        mode: "selection",
        groupes: acquereurValide
          ? grouperParCompatibilite(await listerBiensActifsDuWorkspace(workspaceId), await evaluerCompatibiliteAcquereur(acquereurValide.id, workspaceId), "bienId", optionBien)
          : [{ label: "Biens", options: (await listerBiensActifsDuWorkspace(workspaceId)).map(optionBien) }],
      };
  const acquereur: ChoixPlanification = acquereurValide
    ? { mode: "fixe", option: optionAcquereur(acquereurValide) }
    : {
        mode: "selection",
        groupes: bienValide
          ? grouperParCompatibilite(await listerAcquereursActifsDuWorkspace(workspaceId), await evaluerCompatibiliteBien(bienValide.id, workspaceId), "acquereurId", optionAcquereur)
          : [{ label: "Acquéreurs", options: (await listerAcquereursActifsDuWorkspace(workspaceId)).map(optionAcquereur) }],
      };

  // Le retour n'a de cible que si l'entité correspondante est réellement résolue.
  const retourEffectif =
    (retour === "bien" && bienValide) || (retour === "acquereur" && acquereurValide) ? retour : undefined;
  const lienRetour = lienRetourFicheVisite(retourEffectif, { bienId: bienValide?.id ?? "", acquereurId: acquereurValide?.id ?? "" });

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={lienRetour.href}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {lienRetour.label}
      </Link>
      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-primary leading-tight mb-1">Planifier une visite</h1>
      <p className="text-[13px] text-text-muted mb-6">Une visite DOMIORA, indépendante de tout agenda externe.</p>
      <Card className="p-4 md:p-5">
        <PlanifierVisiteForm bien={bien} acquereur={acquereur} dateParDefaut={formatDateISO(new Date())} retour={retourEffectif} />
      </Card>
    </div>
  );
}
