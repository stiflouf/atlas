import type { Bien, StatutMandat } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { TransportsProximite, VelibProximite } from "@/types/transports";
import type { PointAttention } from "@/types/pointsAttention";
import { RAYON_METRES_TRANSPORTS } from "@/lib/transports/constantes";

// Ce que chaque règle peut lire. Volontairement limité aux champs structurés déjà fiables
// aujourd'hui — les futurs champs bien.etage / bien.ascenseur / acquereur.contraintesMobilite /
// acquereur.piecesMin / acquereur.surfaceMin viendront s'y ajouter quand ils existeront, sans
// rien casser des règles déjà écrites.
export type ContextePointsAttention = {
  bien: Bien;
  acquereur: ProfilAcquereur;
  transports?: TransportsProximite;
  velib?: VelibProximite;
};

type ReglePointAttention = {
  id: string;
  evaluer: (contexte: ContextePointsAttention) => PointAttention | undefined;
};

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

const libelleStatutMandat: Record<StatutMandat, string> = {
  actif: "actif",
  suspendu: "suspendu",
  expire: "expiré",
};

const reglePrixSuperieurBudgetMax: ReglePointAttention = {
  id: "prix_superieur_budget_max",
  evaluer: ({ bien, acquereur }) => {
    if (bien.prix <= acquereur.budgetMax) return undefined;
    return {
      id: "prix_superieur_budget_max",
      texte: `Le prix affiché (${formatPrix(bien.prix)}) dépasse le budget maximum indiqué par l'acquéreur (${formatPrix(acquereur.budgetMax)}).`,
      provenance: "Bien (prix affiché) × Acquéreur (budget maximum déclaré)",
    };
  },
};

const regleMandatNonActif: ReglePointAttention = {
  id: "mandat_non_actif",
  evaluer: ({ bien }) => {
    if (bien.statutMandat === "actif") return undefined;
    return {
      id: "mandat_non_actif",
      texte: `Le mandat de ce bien n'est pas actif (statut : ${libelleStatutMandat[bien.statutMandat]}).`,
      provenance: "Bien (statut du mandat)",
    };
  },
};

// Ne se déclenche que si les deux appels ont réellement répondu et trouvé zéro résultat — jamais
// en cas d'échec d'appel, pour ne pas confondre "rien trouvé" et "on n'a pas pu vérifier".
const regleAucunTransportProche: ReglePointAttention = {
  id: "aucun_transport_proche",
  evaluer: ({ transports, velib }) => {
    if (!transports || !velib) return undefined;
    if (transports.arrets.length > 0 || velib.stations.length > 0) return undefined;
    return {
      id: "aucun_transport_proche",
      texte: `Aucun arrêt de transport en commun ni station Vélib' trouvé à moins de ${RAYON_METRES_TRANSPORTS} m du bien.`,
      provenance: "PRIM (Île-de-France Mobilités) + Vélib' Métropole (GBFS)",
    };
  },
};

const regles: ReglePointAttention[] = [
  reglePrixSuperieurBudgetMax,
  regleMandatNonActif,
  regleAucunTransportProche,
];

export function produirePointsAttention(contexte: ContextePointsAttention): PointAttention[] {
  return regles.map((regle) => regle.evaluer(contexte)).filter((p): p is PointAttention => p !== undefined);
}
