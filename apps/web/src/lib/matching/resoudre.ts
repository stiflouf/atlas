import type { CandidatBien, CandidatClient, CandidatType } from "@/types/contexteRendezVous";

// Utilisable directement, sans confirmation humaine.
export const SEUIL_FORT = 0.8;
// En dessous : candidat écarté, considéré comme du bruit.
export const SEUIL_AMBIGU = 0.5;
// Si les deux meilleurs candidats sont à moins de ce delta l'un de l'autre, on traite comme
// ambigu même si le premier dépasse SEUIL_FORT — protège contre les faux positifs proches.
export const DELTA_AMBIGUITE = 0.1;

const POIDS_BIEN = 0.45;
const POIDS_CLIENT = 0.45;
const POIDS_TYPE = 0.1;

function meilleursCandidats<T extends { confidence: number }>(candidats: T[]): T[] {
  return [...candidats]
    .filter((c) => c.confidence >= SEUIL_AMBIGU)
    .sort((a, b) => b.confidence - a.confidence);
}

function estNetVainqueur(meilleur: { confidence: number }, second: { confidence: number } | undefined): boolean {
  return !second || meilleur.confidence - second.confidence >= DELTA_AMBIGUITE;
}

export function resoudreBien(candidats: CandidatBien[]): {
  bien?: CandidatBien;
  bienCandidats?: CandidatBien[];
  necessiteConfirmationBien: boolean;
} {
  const tries = meilleursCandidats(candidats);
  if (tries.length === 0) return { necessiteConfirmationBien: false };

  const [meilleur, second] = tries;
  if (meilleur.confidence >= SEUIL_FORT && estNetVainqueur(meilleur, second)) {
    return { bien: meilleur, necessiteConfirmationBien: false };
  }
  return { bienCandidats: tries.slice(0, 3), necessiteConfirmationBien: true };
}

// Le client n'a pas de mécanisme de confirmation dédié ce sprint : s'il est ambigu, il reste
// simplement non résolu (pas de bannière) — la conséquence (ex. CTA Préparer) ne s'affichera
// pas, ce qui est honnête plutôt qu'une fausse certitude.
export function resoudreClient(candidats: CandidatClient[]): CandidatClient | undefined {
  const tries = meilleursCandidats(candidats);
  if (tries.length === 0) return undefined;

  const [meilleur, second] = tries;
  return meilleur.confidence >= SEUIL_FORT && estNetVainqueur(meilleur, second) ? meilleur : undefined;
}

// Confiance globale de la résolution métier — permet à l'UI de décider si le contexte vaut la
// peine d'être exploité du tout, en complément des confiances individuelles.
export function calculerConfianceGlobale(
  bien?: CandidatBien,
  client?: CandidatClient,
  type?: CandidatType
): number {
  const score =
    (bien?.confidence ?? 0) * POIDS_BIEN +
    (client?.confidence ?? 0) * POIDS_CLIENT +
    (type?.confidence ?? 0) * POIDS_TYPE;
  return Math.round(score * 100) / 100;
}
