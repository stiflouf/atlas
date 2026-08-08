import type { ActionMetier } from "@/types/action";

export const actionsMetier: ActionMetier[] = [
  {
    id: "act-001",
    titre: "Relancer les Dubois pour confirmer leur intention d'offre",
    contexte:
      "Offre orale évoquée après la 2e visite du 1er août, aucune relance envoyée depuis une semaine.",
    statut: "a_faire",
    priorite: "haute",
    type: "suivi_offre",
    entite: { type: "bien", id: "bien-001" },
    dateCreation: "2026-08-01",
  },
  {
    id: "act-002",
    titre: "Mettre à jour l'annonce SeLoger avec les nouvelles photos",
    contexte: "Photos reçues le 28 juin.",
    statut: "a_faire",
    priorite: "basse",
    type: "commercial",
    entite: { type: "bien", id: "bien-001" },
    dateCreation: "2026-06-28",
  },
  {
    id: "act-003",
    titre: "Vérifier la quote-part des travaux de ravalement 2027",
    contexte: "À mentionner dans la promesse de vente.",
    statut: "a_faire",
    priorite: "normale",
    type: "administratif",
    entite: { type: "bien", id: "bien-001" },
    dateCreation: "2026-06-01",
  },
  {
    id: "act-004",
    titre: "Relire le compromis avant signature",
    contexte: "Signature de l'acte prévue le 14 août.",
    statut: "a_faire",
    priorite: "haute",
    echeance: "2026-08-14",
    type: "juridique",
    entite: { type: "bien", id: "bien-002" },
    dateCreation: "2026-08-05",
  },
  {
    id: "act-005",
    titre: "Prévenir le notaire de la disponibilité des vendeurs",
    contexte: "Formalité avant signature.",
    statut: "a_faire",
    priorite: "normale",
    type: "administratif",
    entite: { type: "bien", id: "bien-002" },
    dateCreation: "2026-08-05",
  },
];

export function getActionsPourBien(bienId: string): ActionMetier[] {
  return actionsMetier.filter((a) => a.entite.type === "bien" && a.entite.id === bienId);
}
