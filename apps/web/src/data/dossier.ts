export type EvenementHistorique = { date: string; auteur: string; texte: string };
export type DocumentBien = { nom: string; date: string; type: string };
export type ActionDossier = { id: string; label: string; contexte?: string };
export type VisiteEffectuee = { id: string; date: string; client: string; retour: string };

export type StatutDossier = "en_commercialisation" | "offre_en_cours" | "compromis_signe";

// Structure typée pour représenter l'état d'un dossier (mandat) à un instant T.
// En Sprint 1.1 les données sont mockées ; un backend pourra alimenter la même forme plus tard.
export type DossierBien = {
  bienId: string;
  statut: StatutDossier;
  // Phrase unique expliquant pourquoi ce dossier mérite l'attention du conseiller maintenant.
  // Absent si le dossier suit son cours normal sans action urgente.
  raisonAttention?: string;
  derniereActivite: string;
  historique: EvenementHistorique[];
  notes: string;
  documents: DocumentBien[];
  actions: ActionDossier[];
  visitesEffectuees: VisiteEffectuee[];
};

export const dossiers: DossierBien[] = [
  {
    bienId: "bien-001",
    statut: "offre_en_cours",
    raisonAttention:
      "Offre orale reçue après la 2e visite, aucune relance envoyée depuis une semaine.",
    derniereActivite: "2026-08-01",
    historique: [
      { date: "2026-08-01", auteur: "Steven G.", texte: "Deuxième visite — retour positif des Dubois. Ils souhaitent faire une offre." },
      { date: "2026-07-18", auteur: "Steven G.", texte: "Première visite avec les Dubois. Très intéressés par la luminosité et la proximité du métro." },
      { date: "2026-07-10", auteur: "Steven G.", texte: "Bien mis en ligne sur SeLoger et LeBonCoin." },
      { date: "2026-06-28", auteur: "Steven G.", texte: "Photos réalisées. Bien prêt à être publié." },
      { date: "2026-05-12", auteur: "Steven G.", texte: "Signature du mandat exclusif. Prix convenu : 520 000€." },
    ],
    notes:
      "Propriétaire motivé à vendre — divorce en cours. Disponible pour les visites en semaine après 17h et le week-end. Ne pas communiquer la raison de la vente aux acquéreurs. Clés disponibles à l'agence.\n\nPoint d'attention : l'immeuble a voté des travaux de ravalement prévu en 2027 (quote-part estimée : 4 200€ pour cet appartement).",
    documents: [
      { nom: "Mandat exclusif signé", date: "2026-05-12", type: "Mandat" },
      { nom: "Diagnostics énergétiques (DPE)", date: "2026-05-20", type: "Diagnostic" },
      { nom: "Règlement de copropriété", date: "2026-05-20", type: "Copropriété" },
      { nom: "3 derniers PV d'AG", date: "2026-05-20", type: "Copropriété" },
      { nom: "Plans de l'appartement", date: "2026-06-01", type: "Technique" },
      { nom: "Photos professionnelles (24 fichiers)", date: "2026-06-28", type: "Commercial" },
    ],
    actions: [
      { id: "a1", label: "Appeler les Dubois pour confirmer leur intention d'offre", contexte: "Suite à la 2e visite du 1er août" },
      { id: "a2", label: "Mettre à jour l'annonce SeLoger avec les nouvelles photos", contexte: "Photos reçues le 28 juin" },
      { id: "a3", label: "Vérifier la quote-part des travaux de ravalement 2027", contexte: "À mentionner dans la promesse de vente" },
    ],
    visitesEffectuees: [
      { id: "v1", date: "2026-08-01", client: "Martin & Sophie Dubois", retour: "Deuxième visite — retour très positif, souhaitent faire une offre." },
      { id: "v2", date: "2026-07-18", client: "Martin & Sophie Dubois", retour: "Première visite — séduits par la luminosité et la proximité du métro." },
    ],
  },
  {
    bienId: "bien-002",
    statut: "compromis_signe",
    raisonAttention: "Compromis signé, relecture à faire avant la signature de l'acte le 14 août.",
    derniereActivite: "2026-08-05",
    historique: [
      { date: "2026-08-05", auteur: "Steven G.", texte: "Compromis de vente signé par les deux parties." },
      { date: "2026-07-22", auteur: "Steven G.", texte: "Offre au prix acceptée par le vendeur." },
      { date: "2026-07-15", auteur: "Steven G.", texte: "Visite avec Élodie Lecomte — très intéressée, dépôt d'une offre au prix." },
      { date: "2026-06-25", auteur: "Steven G.", texte: "Bien mis en ligne sur SeLoger et LeBonCoin." },
      { date: "2026-06-20", auteur: "Steven G.", texte: "Signature du mandat exclusif. Prix convenu : 785 000€." },
    ],
    notes:
      "Vendeurs déjà relogés — disponibles pour une signature rapide. Garage double à vérifier lors de l'état des lieux (une télécommande manquante a été signalée).",
    documents: [
      { nom: "Mandat exclusif signé", date: "2026-06-20", type: "Mandat" },
      { nom: "Compromis de vente", date: "2026-08-05", type: "Compromis" },
      { nom: "Diagnostics énergétiques (DPE)", date: "2026-06-22", type: "Diagnostic" },
      { nom: "Plans de la maison", date: "2026-06-25", type: "Technique" },
    ],
    actions: [
      { id: "b1", label: "Relire le compromis avant signature", contexte: "Signature de l'acte prévue le 14 août" },
      { id: "b2", label: "Prévenir le notaire de la disponibilité des vendeurs", contexte: "Formalité avant signature" },
    ],
    visitesEffectuees: [
      { id: "v3", date: "2026-07-15", client: "Élodie Lecomte", retour: "Coup de cœur immédiat pour le jardin et le calme du quartier." },
    ],
  },
];

export function getDossierByBienId(bienId: string): DossierBien | undefined {
  return dossiers.find((d) => d.bienId === bienId);
}

export function getDossiersAvecAttention(): DossierBien[] {
  return dossiers.filter((d) => d.raisonAttention);
}
