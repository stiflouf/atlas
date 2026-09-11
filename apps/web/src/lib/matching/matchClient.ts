import type { ProfilAcquereur } from "@/types/client";
import type { RendezVous } from "@/types/agenda";
import type { CandidatClient } from "@/types/contexteRendezVous";
import { contientMot, normaliser } from "./normaliser";

export function matcherClient(rdv: RendezVous, clients: ProfilAcquereur[]): CandidatClient[] {
  const texte = normaliser(`${rdv.titre} ${rdv.lieu ?? ""}`);
  const candidats: CandidatClient[] = [];

  for (const client of clients) {
    const nom = normaliser(client.nom);
    // ADR-057 — le prénom peut légitimement être inconnu (un Contact n'a que `nom` de garanti).
    // `normaliser(undefined)` LÈVE (`.normalize` sur undefined) : sans cette garde, un acquéreur
    // sans prénom ferait échouer tout le rapprochement d'un rendez-vous, pas seulement le sien.
    // `contientMot` refuse déjà un mot vide, il n'y a donc jamais eu de risque de correspondance
    // universelle — ce qui est écarté ici, c'est le plantage.
    const prenom = client.prenom ? normaliser(client.prenom) : undefined;
    const aNom = contientMot(texte, nom);
    const aPrenom = prenom !== undefined && contientMot(texte, prenom);

    if (aNom && aPrenom) {
      candidats.push({ clientId: client.id, confidence: 0.9, matchedBy: "nom_complet_client" });
    } else if (aNom) {
      candidats.push({ clientId: client.id, confidence: 0.65, matchedBy: "nom_client" });
    } else if (aPrenom) {
      candidats.push({ clientId: client.id, confidence: 0.45, matchedBy: "prenom_client" });
    }
  }

  return candidats;
}
