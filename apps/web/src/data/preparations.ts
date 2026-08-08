import type { PreparationVisite } from "@/types/preparation";
import { biens } from "./biens";
import { clients } from "./clients";

export const preparations: PreparationVisite[] = [
  {
    id: "prep-rdv-001",
    bien: biens[0]!,
    acquereur: clients[0]!,
    dateVisite: "2026-08-07",
    heureVisite: "10h00",

    resumeBien:
      "3 pièces de 68m² au 4e étage d'un immeuble Haussmann rénové en 2019, plein sud, à 3 minutes du métro Oberkampf. Affiché 17% sous le prix moyen du secteur, avec des charges faibles — mais sans ascenseur ni parking.",

    pointsForts: [
      "Luminosité exceptionnelle — double exposition plein sud, lumière toute la journée",
      "Métro Oberkampf (ligne 9) à 3 minutes à pied — trajet direct vers le 8e",
      "Immeuble entièrement rénové en 2019 — aucun travaux à prévoir",
      "Charges très faibles (220€/mois) — copropriété saine, gestion rigoureuse",
      "Prix en dessous du marché : 7 647€/m² pour un secteur à 9 200€/m² en moyenne",
    ],

    vigilances: [
      "Pas de parking inclus — stationnement payant dans le secteur (zone bleue)",
      "4e étage sans ascenseur — point sensible pour Sophie si mobilité contrainte",
      "Troisième chambre de 9m² — ne pas la présenter comme une chambre double",
      "Ambiance festive le week-end autour de la rue Oberkampf — à mentionner honnêtement",
    ],

    questionsASuggerer: [
      "Comment imaginez-vous votre quotidien dans cet appartement ?",
      "Avez-vous un véhicule ? Le stationnement est à anticiper dans ce secteur.",
      "La configuration 3 pièces convient-elle à votre organisation actuelle ?",
      "Y a-t-il des travaux ou aménagements que vous envisageriez ?",
      "Quel est votre calendrier idéal pour emménager ?",
    ],

    objectionsProbables: [
      {
        objection: "C'est encore légèrement au-dessus de notre budget.",
        reponse:
          "Le bien est affiché à 520 000€, ce qui est dans votre fourchette haute. Une négociation de 2 à 3% est envisageable, ce qui le ramènerait entre 504 000 et 510 000€. Avec les taux actuels à 3,5%, cela représente environ 80€/mois de différence.",
      },
      {
        objection: "Pas d'ascenseur, c'est contraignant.",
        reponse:
          "C'est un point réel à considérer, surtout avec un jeune enfant. D'un autre côté, c'est souvent ce qui permet de négocier et de maintenir des charges très basses. Le 4e sans ascenseur dans un immeuble Haussmann rénové reste très recherché.",
      },
      {
        objection: "La troisième chambre est trop petite.",
        reponse:
          "Elle fait 9m², ce qui permet d'y installer un lit enfant ou un bureau. Voulez-vous qu'on regarde ensemble comment l'optimiser ? Certains clients l'ont transformée en chambre d'enfant avec une mezzanine.",
      },
      {
        objection: "Le quartier est un peu bruyant le week-end.",
        reponse:
          "C'est vrai que la rue Oberkampf est animée le vendredi et samedi soir. L'appartement donne sur une cour intérieure côté chambre, ce qui atténue beaucoup. Et c'est aussi ce qui rend le quartier vivant et attractif au quotidien.",
      },
    ],

    contextQuartier: {
      description:
        "Le 11e arrondissement, quartier Oberkampf — l'un des secteurs les plus recherchés de Paris pour sa vie de quartier, ses commerces de proximité et son excellent niveau de desserte. Ambiance mixte, populaire et bobo, avec une forte dynamique commerciale.",
      transports: [
        "Métro ligne 9 — Oberkampf (3 min à pied)",
        "Métro ligne 5 — République (8 min à pied)",
        "Bus 96, 56 — arrêt devant l'immeuble",
        "Vélib' — station à 2 min",
      ],
      commerces: [
        "Marché Bastille — jeudi et dimanche matin (5 min)",
        "Monoprix — 2 minutes à pied",
        "Boulangerie primée — rue Oberkampf (1 min)",
        "Restaurants et cafés — rue Oberkampf et rue Saint-Maur",
      ],
      ecoles: [
        "École primaire Jules Vallès — 250m (très bien notée)",
        "Collège Voltaire — 500m",
        "Lycée Voltaire — 550m",
      ],
      pointsAttention: [
        "Rue Oberkampf animée le vendredi et samedi soir — les chambres donnent sur cour",
        "Stationnement limité dans le secteur (zone bleue payante)",
      ],
    },

    analyseMarche: {
      prixMoyenM2: 9200,
      tendance: "Légère baisse de 2% sur 12 mois dans le 11e arrondissement",
      ecartAvecMarche: "Le bien est affiché 17% sous la moyenne du secteur",
      comparables: [
        {
          adresse: "87 rue Oberkampf — 3P / 72m²",
          surface: 72,
          prix: 675000,
          prixM2: 9375,
          dateVente: "2026-04-15",
        },
        {
          adresse: "12 rue Saint-Maur — 3P / 65m²",
          surface: 65,
          prix: 598000,
          prixM2: 9200,
          dateVente: "2026-02-28",
        },
        {
          adresse: "34 rue de la Folie-Méricourt — 3P / 70m²",
          surface: 70,
          prix: 631000,
          prixM2: 9014,
          dateVente: "2025-11-10",
        },
      ],
    },

    contexteHumain: [
      "Le quartier tire son nom de Christophe-Philippe Oberkampf (1738–1815), industriel qui fonda la Manufacture royale de toiles peintes de Jouy-en-Josas ; la rue porte son nom depuis 1864.",
      "Le Cirque d'Hiver, à 500m, inauguré en 1852 sous Napoléon III, accueille toujours des spectacles aujourd'hui.",
      "Le quartier a connu une forte gentrification dans les années 1990-2000, tout en conservant son caractère populaire et cosmopolite — l'un des secteurs les plus dynamiques de la Rive Droite.",
      "L'immeuble lui-même, construit à la fin du XIXe siècle, illustre bien ce mélange : architecture haussmannienne classique et rénovation intérieure entièrement contemporaine.",
    ],
  },
];

export function getPreparationByRdvId(rdvId: string): PreparationVisite | undefined {
  return preparations.find((p) => `prep-${rdvId}` === p.id);
}
