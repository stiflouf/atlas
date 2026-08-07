import type { RendezVous, Relance, ActionPrevue } from "@/types/agenda";

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

export const relances: Relance[] = [
  {
    id: "relance-001",
    clientId: "client-004",
    client: { nom: "Tissier", prenom: "Jean-Marc" },
    motif: "Prospect chaud — aucune réponse depuis 12 jours",
    priorite: "haute",
    joursAttente: 12,
    actionSuggeree: "Lui envoyer un message de relance personnalisé",
    actionType: "message",
  },
  {
    id: "relance-002",
    clientId: "client-003",
    client: { nom: "Fontaine", prenom: "Pierre" },
    motif: "Délai de réflexion sur l'offre expire demain",
    priorite: "haute",
    joursAttente: 0,
    actionSuggeree: "Appeler avant 18h pour connaître la décision",
    actionType: "appel",
  },
];

export const actionsPrevues: ActionPrevue[] = [
  {
    id: "action-001",
    label: "Compléter le dossier Moreau",
    contexte: "Documents manquants : carte d'identité + avis d'imposition",
    echeance: "2026-08-09",
  },
  {
    id: "action-002",
    label: "Relire le compromis avant signature",
    contexte: "Signature prévue jeudi 14 août — Dossier Vincennes",
    echeance: "2026-08-13",
  },
  {
    id: "action-003",
    label: "Publier l'annonce Vincennes",
    contexte: "Photos disponibles — en attente de validation du prix",
  },
];
