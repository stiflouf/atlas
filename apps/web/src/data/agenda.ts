import type { RendezVous } from "@/types/agenda";

export const rendezVousDuJour: RendezVous[] = [
  {
    id: "rdv-001",
    heure: "10h00",
    type: "visite",
    titre: "Visite — Appartement Oberkampf",
    lieu: "123 rue de la Paix, Paris 11e",
    bien: { id: "bien-001", adresse: "123 rue de la Paix, Paris 11e" },
    client: { id: "client-001", nom: "Dubois", prenom: "Martin & Sophie" },
    preparationDisponible: true,
  },
  {
    id: "rdv-002",
    heure: "14h30",
    type: "estimation",
    titre: "Estimation — Maison Vincennes",
    lieu: "45 allée des Roses, Vincennes",
    bien: { id: "bien-002", adresse: "45 allée des Roses, Vincennes" },
    client: { id: "client-002", nom: "Lecomte", prenom: "Élodie" },
    preparationDisponible: false,
  },
  {
    id: "rdv-003",
    heure: "17h00",
    type: "appel",
    titre: "Appel — Suivi offre Batignolles",
    client: { id: "client-003", nom: "Fontaine", prenom: "Pierre" },
    preparationDisponible: false,
  },
];
