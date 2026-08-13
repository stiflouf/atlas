import { construireIdAlerte } from "@/lib/alertes/id";
import type { ContexteAlertes } from "@/lib/alertes/contexte";
import type { AlerteCopilote } from "@/types/alerte";

type RegleAlerteCommercial = {
  id: string;
  evaluer: (contexte: ContexteAlertes) => AlerteCopilote[];
};

// B1 — vocabulaire neutre imposé par le plan : "encaissement attendu dépassé", jamais "retard" ni
// "incident" ni "anomalie" (dateEncaissementPrevue reste une prévision corrigible). Les états normaux
// (vente finalisée non encaissée seule, rémunération prévisionnelle seule, compromis en cours seul)
// ne sont volontairement jamais des alertes.
const regleEncaissementAttenduDepasse: RegleAlerteCommercial = {
  id: "encaissement_attendu_depasse",
  evaluer: (contexte) => {
    const { projectionAnnuelle, dossierFiscalId } = contexte;
    if (projectionAnnuelle.nombreEncaissementsAttendusDepasses <= 0) return [];
    const { nombreEncaissementsAttendusDepasses, encaissementsAttendusDepassesCentimes, annee } = projectionAnnuelle;
    return [
      {
        id: construireIdAlerte("encaissement_attendu_depasse", dossierFiscalId, annee),
        type: "encaissement_attendu_depasse",
        categorie: "commercial",
        niveau: "attention",
        titre: `${nombreEncaissementsAttendusDepasses} encaissement${nombreEncaissementsAttendusDepasses > 1 ? "s" : ""} attendu${nombreEncaissementsAttendusDepasses > 1 ? "s" : ""} dépassé${nombreEncaissementsAttendusDepasses > 1 ? "s" : ""}`,
        explication: `${nombreEncaissementsAttendusDepasses} vente${nombreEncaissementsAttendusDepasses > 1 ? "s" : ""} finalisée${nombreEncaissementsAttendusDepasses > 1 ? "s" : ""} dispose${nombreEncaissementsAttendusDepasses > 1 ? "nt" : ""} d'une date d'encaissement prévue déjà dépassée sans encaissement réel enregistré. Cette date reste une prévision corrigible, pas nécessairement un incident.`,
        donneesDeclencheuses: { dossierFiscalId, annee },
        provenance: [
          {
            source: "metrique_dashboard",
            nom: "encaissementsAttendusDepassesCentimes",
            valeurCentimes: encaissementsAttendusDepassesCentimes ?? 0,
          },
        ],
      },
    ];
  },
};

const regles: RegleAlerteCommercial[] = [regleEncaissementAttenduDepasse];

export function produireAlertesCommercial(contexte: ContexteAlertes): AlerteCopilote[] {
  return regles.flatMap((regle) => regle.evaluer(contexte));
}
