import type { Bien } from "@/types/bien";

export const biens: Bien[] = [
  {
    id: "bien-001",
    reference: "ATL-2024-001",
    titre: "Appartement Oberkampf — 3 pièces lumineux",
    type: "appartement",
    adresse: "123 rue Oberkampf",
    ville: "Paris",
    codePostal: "75011",
    surface: 68,
    pieces: 3,
    prix: 520000,
    statutMandat: "actif",
    dateMandat: "2026-05-12",
    caracteristiques: [
      "Plein sud — double exposition",
      "4e étage sans ascenseur",
      "Immeuble Haussmann rénové 2019",
      "Cuisine équipée Miele",
      "Parquet chêne massif",
      "Cave",
      "Charges 220€/mois",
    ],
    description:
      "Bel appartement de 3 pièces dans un immeuble Haussmann entièrement rénové en 2019. Très lumineux grâce à son double exposition plein sud. Cuisine entièrement équipée. À 3 minutes à pied du métro Oberkampf (ligne 9). Copropriété saine avec charges faibles.",
  },
  {
    id: "bien-002",
    reference: "ATL-2024-002",
    titre: "Maison avec jardin — Vincennes",
    type: "maison",
    adresse: "45 allée des Roses",
    ville: "Vincennes",
    codePostal: "94300",
    surface: 112,
    pieces: 5,
    prix: 785000,
    statutMandat: "actif",
    dateMandat: "2026-06-20",
    caracteristiques: [
      "Jardin 180m²",
      "Garage double",
      "Rénovée en 2022",
      "Terrasse couverte",
      "Cave et cellier",
      "Quartier calme",
    ],
    description:
      "Maison familiale de 5 pièces entièrement rénovée en 2022, avec un jardin de 180m² exposé sud-ouest. Garage double. Idéalement située à 5 minutes du RER A et à proximité immédiate du Bois de Vincennes. Secteur scolaire très recherché.",
  },
];

export function getBienById(id: string): Bien | undefined {
  return biens.find((b) => b.id === id);
}
