import type { Bien, StatutMandat } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { TransportsProximite, VelibProximite } from "@/types/transports";
import type { PointAttention } from "@/types/pointsAttention";
import { RAYON_METRES_TRANSPORTS } from "@/lib/transports/constantes";
import {
  evaluerAccessibilite,
  evaluerBudgetMax,
  evaluerExterieur,
  evaluerParking,
  evaluerPieces,
  evaluerSurface,
} from "@/lib/compatibilite/criteres";

// Ce que chaque règle peut lire. Bien/acquereur exposent maintenant des champs structurés
// (étage, ascenseur, parking, extérieur, pièces/surface min, accessibilité...) en plus des champs
// de base — de futurs champs pourront s'y ajouter sans rien casser des règles déjà écrites.
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
    if (evaluerBudgetMax(bien, acquereur).statut !== "incompatible") return undefined;
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

// Croisements bien × acquéreur — champs structurés uniquement, aucune lecture de texte libre.
// La décision (compatible/incompatible/a_verifier/non_concerne) est déléguée aux fonctions de
// critère partagées de src/lib/compatibilite/criteres.ts (ADR-034, section 11) : source unique de
// chaque règle métier, jamais réimplémentée ici. pointsAttention n'en garde que sa propre
// sémantique éditoriale — ne signaler qu'un fait négatif certain (statut === "incompatible"),
// rester silencieux sur "a_verifier"/"non_concerne"/"compatible" — et sa propre formulation,
// pensée pour la Mémoire du dossier plutôt que pour l'explicabilité critère par critère d'ADR-034.

const regleAccessibilite: ReglePointAttention = {
  id: "accessibilite_requise",
  evaluer: ({ bien, acquereur }) => {
    if (evaluerAccessibilite(bien, acquereur).statut !== "incompatible") return undefined;
    return {
      id: "accessibilite_requise",
      texte: `Ce bien est au ${bien.etage}e étage sans ascenseur, alors que l'accessibilité du logement est indiquée comme nécessaire pour cette recherche.`,
      provenance: "Bien (étage, ascenseur) × Acquéreur (accessibilité requise)",
    };
  },
};

const reglePiecesInsuffisantes: ReglePointAttention = {
  id: "pieces_insuffisantes",
  evaluer: ({ bien, acquereur }) => {
    if (evaluerPieces(bien, acquereur).statut !== "incompatible") return undefined;
    return {
      id: "pieces_insuffisantes",
      texte: `Le bien a moins de pièces (${bien.pieces}) que le minimum recherché par l'acquéreur (${acquereur.piecesMin}).`,
      provenance: "Bien (nombre de pièces) × Acquéreur (pièces minimum recherché)",
    };
  },
};

const regleSurfaceInsuffisante: ReglePointAttention = {
  id: "surface_insuffisante",
  evaluer: ({ bien, acquereur }) => {
    if (evaluerSurface(bien, acquereur).statut !== "incompatible") return undefined;
    return {
      id: "surface_insuffisante",
      texte: `Le bien est plus petit (${bien.surface} m²) que la surface minimum recherchée par l'acquéreur (${acquereur.surfaceMin} m²).`,
      provenance: "Bien (surface) × Acquéreur (surface minimum recherchée)",
    };
  },
};

const regleParkingManquant: ReglePointAttention = {
  id: "parking_manquant",
  evaluer: ({ bien, acquereur }) => {
    if (evaluerParking(bien, acquereur).statut !== "incompatible") return undefined;
    return {
      id: "parking_manquant",
      texte: "Un parking est requis par l'acquéreur, mais ce bien n'en propose pas.",
      provenance: "Bien (parking) × Acquéreur (parking nécessaire)",
    };
  },
};

const regleExterieurManquant: ReglePointAttention = {
  id: "exterieur_manquant",
  evaluer: ({ bien, acquereur }) => {
    if (evaluerExterieur(bien, acquereur).statut !== "incompatible") return undefined;
    return {
      id: "exterieur_manquant",
      texte: "Un extérieur (balcon, terrasse ou jardin) est requis par l'acquéreur, mais ce bien n'en a aucun.",
      provenance: "Bien (extérieur) × Acquéreur (extérieur nécessaire)",
    };
  },
};

const regles: ReglePointAttention[] = [
  reglePrixSuperieurBudgetMax,
  regleMandatNonActif,
  regleAucunTransportProche,
  regleAccessibilite,
  reglePiecesInsuffisantes,
  regleSurfaceInsuffisante,
  regleParkingManquant,
  regleExterieurManquant,
];

export function produirePointsAttention(contexte: ContextePointsAttention): PointAttention[] {
  return regles.map((regle) => regle.evaluer(contexte)).filter((p): p is PointAttention => p !== undefined);
}
