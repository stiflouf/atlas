import type { ProfilAcquereur } from "@/types/client";
import type { RendezVous } from "@/types/agenda";
import type { CandidatClient } from "@/types/contexteRendezVous";
import { contientMot, normaliser } from "./normaliser";

export function matcherClient(rdv: RendezVous, clients: ProfilAcquereur[]): CandidatClient[] {
  const texte = normaliser(`${rdv.titre} ${rdv.lieu ?? ""}`);
  const candidats: CandidatClient[] = [];

  for (const client of clients) {
    const nom = normaliser(client.nom);
    const prenom = normaliser(client.prenom);
    const aNom = contientMot(texte, nom);
    const aPrenom = contientMot(texte, prenom);

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
