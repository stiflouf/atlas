export type EvenementHistorique = { date: string; auteur: string; texte: string };
export type DocumentBien = { nom: string; date: string; type: string };
export type VisiteEffectuee = { id: string; date: string; client: string; retour: string };

export type StatutDossier = "en_commercialisation" | "offre_en_cours" | "compromis_signe";

// Structure typée pour représenter l'état d'un dossier (mandat) à un instant T.
// Les actions ne sont plus stockées ici : elles vivent dans data/actions.ts et
// sont la source unique à partir de laquelle l'UI dérive la raison d'attention.
export type DossierBien = {
  bienId: string;
  statut: StatutDossier;
  derniereActivite: string;
  historique: EvenementHistorique[];
  notes: string;
  documents: DocumentBien[];
  visitesEffectuees: VisiteEffectuee[];
};

export const dossiers: DossierBien[] = [
  {
    bienId: "bien-001",
    statut: "offre_en_cours",
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
    visitesEffectuees: [
      { id: "v1", date: "2026-08-01", client: "Martin & Sophie Dubois", retour: "Deuxième visite — retour très positif, souhaitent faire une offre." },
      { id: "v2", date: "2026-07-18", client: "Martin & Sophie Dubois", retour: "Première visite — séduits par la luminosité et la proximité du métro." },
    ],
  },
  {
    bienId: "bien-002",
    statut: "compromis_signe",
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
    visitesEffectuees: [
      { id: "v3", date: "2026-07-15", client: "Élodie Lecomte", retour: "Coup de cœur immédiat pour le jardin et le calme du quartier." },
    ],
  },
];

export function getDossierByBienId(bienId: string): DossierBien | undefined {
  return dossiers.find((d) => d.bienId === bienId);
}
