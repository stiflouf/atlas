import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { EvaluationCritere } from "./types";

// Une fonction pure par critère, réutilisée à la fois par evaluerCompatibilite() (ADR-034) et par
// pointsAttention/moteur.ts (ADR-034, section 11) — source unique de chaque décision métier.
// Aucune lecture de champ de texte libre (notes, criteres, caracteristiques, description) : ADR-008
// reste applicable, uniquement des champs structurés (ADR-009).

function formatMontant(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    centimes
  );
}

// Contrainte dure (ADR-034, section 3) : budgetMax et bien.prix sont tous deux NOT NULL en base
// (schema.ts) — toujours évaluable, jamais de non_concerne ni de a_verifier pour ce critère.
// budgetMin n'a volontairement AUCUNE sémantique dans ce moteur (décision explicite ADR-034) :
// un bien moins cher que budgetMin n'est jamais incompatible pour ce seul motif — le champ reste
// dans le modèle sans être lu ici.
export function evaluerBudgetMax(bien: Bien, acquereur: ProfilAcquereur): EvaluationCritere {
  const critere = "budget_max";
  const label = "Budget maximum";
  const exigenceAcquereur = acquereur.budgetMax;
  const valeurBien = bien.prix;
  if (bien.prix > acquereur.budgetMax) {
    return {
      critere,
      label,
      exigenceAcquereur,
      valeurBien,
      statut: "incompatible",
      explication: `Le prix du bien (${formatMontant(bien.prix)}) dépasse le budget maximum de l'acquéreur (${formatMontant(acquereur.budgetMax)}).`,
    };
  }
  return {
    critere,
    label,
    exigenceAcquereur,
    valeurBien,
    statut: "compatible",
    explication: `Le prix du bien (${formatMontant(bien.prix)}) respecte le budget maximum de l'acquéreur (${formatMontant(acquereur.budgetMax)}).`,
  };
}

// bien.pieces est NOT NULL en base (schema.ts, integer("pieces").notNull()) — vérifié explicitement
// pour cette ADR, jamais undefined pour un bien réel. Si le modèle venait un jour à autoriser une
// valeur réellement inconnue à l'exécution, elle devrait produire 'a_verifier', jamais une
// hypothèse — mais ce cas n'existe pas aujourd'hui, aucune branche morte n'est ajoutée pour lui.
export function evaluerPieces(bien: Bien, acquereur: ProfilAcquereur): EvaluationCritere {
  const critere = "pieces_min";
  const label = "Nombre de pièces minimum";
  if (acquereur.piecesMin === undefined) {
    return {
      critere,
      label,
      valeurBien: bien.pieces,
      statut: "non_concerne",
      explication: "Aucun nombre de pièces minimum n'est renseigné pour cet acquéreur.",
    };
  }
  const exigenceAcquereur = acquereur.piecesMin;
  if (bien.pieces >= acquereur.piecesMin) {
    return {
      critere,
      label,
      exigenceAcquereur,
      valeurBien: bien.pieces,
      statut: "compatible",
      explication: `Le bien a ${bien.pieces} pièce(s), au moins autant que le minimum recherché (${acquereur.piecesMin}).`,
    };
  }
  return {
    critere,
    label,
    exigenceAcquereur,
    valeurBien: bien.pieces,
    statut: "incompatible",
    explication: `Le bien a ${bien.pieces} pièce(s), moins que le minimum recherché (${acquereur.piecesMin}).`,
  };
}

// Même garantie que evaluerPieces() : bien.surface est NOT NULL en base (real("surface").notNull()).
export function evaluerSurface(bien: Bien, acquereur: ProfilAcquereur): EvaluationCritere {
  const critere = "surface_min";
  const label = "Surface minimum";
  if (acquereur.surfaceMin === undefined) {
    return {
      critere,
      label,
      valeurBien: bien.surface,
      statut: "non_concerne",
      explication: "Aucune surface minimum n'est renseignée pour cet acquéreur.",
    };
  }
  const exigenceAcquereur = acquereur.surfaceMin;
  if (bien.surface >= acquereur.surfaceMin) {
    return {
      critere,
      label,
      exigenceAcquereur,
      valeurBien: bien.surface,
      statut: "compatible",
      explication: `Le bien fait ${bien.surface} m², au moins autant que le minimum recherché (${acquereur.surfaceMin} m²).`,
    };
  }
  return {
    critere,
    label,
    exigenceAcquereur,
    valeurBien: bien.surface,
    statut: "incompatible",
    explication: `Le bien fait ${bien.surface} m², moins que le minimum recherché (${acquereur.surfaceMin} m²).`,
  };
}

// Invariant absolu (ADR-009) : inconnu ≠ false. bien.parking undefined produit 'a_verifier',
// jamais 'incompatible' — seule une valeur false explicite le fait.
export function evaluerParking(bien: Bien, acquereur: ProfilAcquereur): EvaluationCritere {
  const critere = "parking";
  const label = "Parking";
  if (acquereur.necessiteParking !== true) {
    return {
      critere,
      label,
      valeurBien: bien.parking,
      statut: "non_concerne",
      explication: "Le parking n'est pas indiqué comme nécessaire par l'acquéreur.",
    };
  }
  if (bien.parking === true) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: true,
      statut: "compatible",
      explication: "Un parking est requis et ce bien en dispose d'un.",
    };
  }
  if (bien.parking === false) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: false,
      statut: "incompatible",
      explication: "Un parking est requis mais ce bien n'en dispose pas.",
    };
  }
  return {
    critere,
    label,
    exigenceAcquereur: true,
    statut: "a_verifier",
    explication: "Un parking est requis mais l'information n'est pas renseignée pour ce bien.",
  };
}

// Jamais déduit de caracteristiques/description/notes (ADR-008) : uniquement bien.exterieur, le
// seul champ structuré. Invariant inconnu ≠ false : absent produit 'a_verifier'.
export function evaluerExterieur(bien: Bien, acquereur: ProfilAcquereur): EvaluationCritere {
  const critere = "exterieur";
  const label = "Extérieur";
  if (acquereur.necessiteExterieur !== true) {
    return {
      critere,
      label,
      valeurBien: bien.exterieur,
      statut: "non_concerne",
      explication: "Un extérieur n'est pas indiqué comme nécessaire par l'acquéreur.",
    };
  }
  if (bien.exterieur === undefined) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      statut: "a_verifier",
      explication: "Un extérieur est requis mais l'information n'est pas renseignée pour ce bien.",
    };
  }
  if (bien.exterieur === "aucun") {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: bien.exterieur,
      statut: "incompatible",
      explication: "Un extérieur est requis mais ce bien n'en a aucun.",
    };
  }
  return {
    critere,
    label,
    exigenceAcquereur: true,
    valeurBien: bien.exterieur,
    statut: "compatible",
    explication: `Un extérieur est requis et ce bien en a un (${bien.exterieur}).`,
  };
}

// accessibiliteRequise porte uniquement sur le besoin fonctionnel immobilier (accessibilité du
// logement) — jamais une donnée de santé ou un diagnostic (voir types/client.ts). Étage 0 (RDC)
// est compatible sans que l'état de l'ascenseur ait besoin d'être connu. bienFormulaire.ts rejette
// tout étage négatif à la saisie (aucun sous-sol représenté par un étage négatif dans ce modèle) —
// une valeur négative malgré tout présente (import direct, etc.) produit 'a_verifier' plutôt
// qu'une sémantique de sous-sol inventée. Invariant inconnu ≠ false pour ascenseur comme pour
// etage : jamais transformé en false.
export function evaluerAccessibilite(bien: Bien, acquereur: ProfilAcquereur): EvaluationCritere {
  const critere = "accessibilite";
  const label = "Accessibilité (étage / ascenseur)";
  if (acquereur.accessibiliteRequise !== true) {
    return {
      critere,
      label,
      statut: "non_concerne",
      explication: "L'accessibilité du logement n'est pas indiquée comme nécessaire par l'acquéreur.",
    };
  }
  if (bien.etage === undefined) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      statut: "a_verifier",
      explication: "L'accessibilité est requise mais l'étage de ce bien n'est pas renseigné.",
    };
  }
  if (bien.etage < 0) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: bien.etage,
      statut: "a_verifier",
      explication: "L'étage renseigné pour ce bien est négatif — hors du modèle actuel, à vérifier manuellement.",
    };
  }
  if (bien.etage === 0) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: bien.etage,
      statut: "compatible",
      explication: "L'accessibilité est requise ; ce bien est de plain-pied (rez-de-chaussée), sans besoin d'ascenseur.",
    };
  }
  if (bien.ascenseur === true) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: bien.etage,
      statut: "compatible",
      explication: `L'accessibilité est requise ; ce bien est au ${bien.etage}e étage avec ascenseur.`,
    };
  }
  if (bien.ascenseur === false) {
    return {
      critere,
      label,
      exigenceAcquereur: true,
      valeurBien: bien.etage,
      statut: "incompatible",
      explication: `L'accessibilité est requise ; ce bien est au ${bien.etage}e étage sans ascenseur.`,
    };
  }
  return {
    critere,
    label,
    exigenceAcquereur: true,
    valeurBien: bien.etage,
    statut: "a_verifier",
    explication: `L'accessibilité est requise ; ce bien est au ${bien.etage}e étage, la présence d'un ascenseur n'est pas renseignée.`,
  };
}
