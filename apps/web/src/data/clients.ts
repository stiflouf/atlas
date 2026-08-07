import type { ProfilAcquereur } from "@/types/client";

export const clients: ProfilAcquereur[] = [
  {
    id: "client-001",
    prenom: "Martin",
    nom: "Dubois",
    email: "martin.dubois@gmail.com",
    telephone: "06 12 34 56 78",
    budgetMin: 480000,
    budgetMax: 550000,
    criteres: [
      "Paris intramuros",
      "3 pièces minimum",
      "Métro à moins de 10 min",
      "Lumineux",
      "Pas de rez-de-chaussée",
    ],
    stadeProjet: "recherche_active",
    notes:
      "Couple avec un enfant de 2 ans. Travaillent tous les deux dans le 8e. Souhaitent rester dans Paris mais pas forcément Rive Droite. Sophie a des contraintes de mobilité — l'absence d'ascenseur est un point à surveiller.",
    datePremiereContact: "2026-03-14",
  },
  {
    id: "client-002",
    prenom: "Élodie",
    nom: "Lecomte",
    email: "elecomte@outlook.fr",
    telephone: "06 87 65 43 21",
    budgetMin: 750000,
    budgetMax: 850000,
    criteres: [
      "Maison avec jardin",
      "Banlieue Est (Val-de-Marne)",
      "5 pièces minimum",
      "Garage",
      "Secteur scolaire recherché",
    ],
    stadeProjet: "recherche_active",
    notes:
      "Famille de 4 personnes (2 enfants 7 et 10 ans). Télétravail partiel — besoin d'un bureau. Budget solide, apport de 200k€. Très intéressés par Vincennes ou Saint-Mandé.",
    datePremiereContact: "2026-04-03",
  },
  {
    id: "client-003",
    prenom: "Pierre",
    nom: "Fontaine",
    email: "p.fontaine@sfr.fr",
    telephone: "06 55 44 33 22",
    budgetMin: 200000,
    budgetMax: 300000,
    criteres: [
      "Paris — arrondissements centraux",
      "Studio ou T2",
      "Investissement locatif",
      "Bon rendement",
    ],
    stadeProjet: "offre",
    notes:
      "Investisseur. A fait une offre sur un studio rue des Batignolles (17e). En attente de réponse du vendeur. Délai de réflexion expire demain. À appeler avant 18h.",
    datePremiereContact: "2026-05-29",
  },
  {
    id: "client-004",
    prenom: "Jean-Marc",
    nom: "Tissier",
    email: "jmtissier@wanadoo.fr",
    telephone: "06 11 22 33 44",
    budgetMin: 350000,
    budgetMax: 420000,
    criteres: ["Paris 10e ou 11e", "2 ou 3 pièces", "Calme", "Lumineux"],
    stadeProjet: "recherche_active",
    notes:
      "Prospect chaud contacté lors d'une journée porte ouverte en mars. Budget confirmé, financement accordé. N'a plus répondu depuis 12 jours — relance prioritaire.",
    datePremiereContact: "2026-03-18",
  },
];

export function getClientById(id: string): ProfilAcquereur | undefined {
  return clients.find((c) => c.id === id);
}
