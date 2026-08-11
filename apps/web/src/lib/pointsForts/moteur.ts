import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { PointFort } from "@/types/pointsForts";

// Ce que chaque règle peut lire. Volontairement limité aux champs structurés du bien et de
// l'acquéreur — un point fort ne se déduit jamais d'un texte libre ni d'un score.
export type ContextePointsForts = {
  bien: Bien;
  acquereur: ProfilAcquereur;
};

type ReglePointFort = {
  id: string;
  evaluer: (contexte: ContextePointsForts) => PointFort | undefined;
};

// Un point fort n'est retenu que s'il dépasse la simple conformité à un critère déjà demandé :
// un bonus non demandé par l'acquéreur, jamais la confirmation qu'un critère exprimé est rempli
// (ça, c'est de la compatibilité normale, pas un argument à mettre en avant).

const regleParkingBonus: ReglePointFort = {
  id: "parking_bonus",
  evaluer: ({ bien, acquereur }) => {
    if (bien.parking !== true) return undefined;
    if (acquereur.necessiteParking === true) return undefined;
    return {
      id: "parking_bonus",
      texte: "Ce bien dispose d'un parking, un atout non demandé explicitement par l'acquéreur.",
      provenance: "Bien (parking) × Acquéreur (parking non requis dans les critères déclarés)",
    };
  },
};

const regleExterieurBonus: ReglePointFort = {
  id: "exterieur_bonus",
  evaluer: ({ bien, acquereur }) => {
    if (bien.exterieur === undefined || bien.exterieur === "aucun") return undefined;
    if (acquereur.necessiteExterieur === true) return undefined;
    return {
      id: "exterieur_bonus",
      texte: `Ce bien dispose d'un extérieur (${bien.exterieur}), un atout non demandé explicitement par l'acquéreur.`,
      provenance: "Bien (extérieur) × Acquéreur (extérieur non requis dans les critères déclarés)",
    };
  },
};

const regles: ReglePointFort[] = [regleParkingBonus, regleExterieurBonus];

export function produirePointsForts(contexte: ContextePointsForts): PointFort[] {
  return regles.map((regle) => regle.evaluer(contexte)).filter((p): p is PointFort => p !== undefined);
}
