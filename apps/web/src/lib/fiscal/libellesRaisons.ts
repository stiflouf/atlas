import { LABEL_REGIME_FISCAL, LABEL_REGIME_TVA } from "@/types/profilFiscal";
import type { RaisonIndisponibilite } from "@/types/resultatFiscal";

// Traduit chaque RaisonIndisponibilite en une phrase française compréhensible sans jargon fiscal —
// affichée sous "Ce qu'Atlas ne sait pas encore calculer et pourquoi" (ADR-024, UX).
export function libelleRaisonIndisponibilite(raison: RaisonIndisponibilite): string {
  switch (raison.type) {
    case "regle_absente":
      return `Le taux ou seuil légal applicable au ${raison.date} n'est pas encore renseigné dans Atlas.`;
    case "profil_inconnu":
      return `Le champ "${raison.champ}" de votre situation fiscale n'est pas renseigné pour le ${raison.date}.`;
    case "assiette_incomplete":
      return raison.periodesInconnues.length > 0
        ? `Vos encaissements ne sont pas confirmés comme complets entre le ${raison.periodesInconnues[0].debut} et le ${raison.periodesInconnues[0].fin} — renseignez vos recettes des années précédentes pour lever cette incertitude.`
        : "Une partie de vos encaissements n'est pas confirmée comme complète.";
    case "rfr_absent":
      return `Le revenu fiscal de référence de ${raison.anneeRfrAttendue} n'a pas été renseigné.`;
    case "amorcage_non_ventilable":
      return "Le taux applicable a changé pendant la période couverte par votre saisie de recettes des années précédentes — impossible de répartir sans le détail jour par jour.";
    case "regime_non_couvert":
      return `Ce calcul n'est pas encore disponible pour le régime "${LABEL_REGIME_FISCAL[raison.regimeFiscal]}".`;
    case "regime_tva_non_supporte":
      return `Ce suivi n'est pas encore disponible pour votre régime de TVA ("${LABEL_REGIME_TVA[raison.regimeTva]}") — Atlas ne stocke pas encore le montant hors taxes nécessaire.`;
  }
}
