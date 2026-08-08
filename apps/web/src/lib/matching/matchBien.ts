import type { Bien } from "@/types/bien";
import type { RendezVous } from "@/types/agenda";
import type { CandidatBien } from "@/types/contexteRendezVous";
import { normaliser } from "./normaliser";

// Règles déterministes, aucune IA. Plusieurs candidats peuvent être retournés pour un même
// rendez-vous : c'est à la couche de résolution (resoudre.ts) de trancher ou de signaler
// une ambiguïté.
export function matcherBien(rdv: RendezVous, biens: Bien[]): CandidatBien[] {
  const texteLieu = normaliser(rdv.lieu ?? "");
  const texteComplet = normaliser(`${rdv.lieu ?? ""} ${rdv.titre}`);
  const candidats: CandidatBien[] = [];

  for (const bien of biens) {
    const reference = normaliser(bien.reference);
    const adresseSeule = normaliser(bien.adresse);
    const adresseComplete = normaliser(`${bien.adresse} ${bien.codePostal} ${bien.ville}`);
    const ville = normaliser(bien.ville);

    if (reference && texteComplet.includes(reference)) {
      candidats.push({ bienId: bien.id, confidence: 0.98, matchedBy: "reference_bien" });
      continue;
    }

    if (adresseSeule && (texteLieu.includes(adresseSeule) || adresseComplete.includes(texteLieu))) {
      candidats.push({ bienId: bien.id, confidence: 0.95, matchedBy: "adresse_bien" });
      continue;
    }

    const motsAdresseSignificatifs = adresseSeule.split(" ").filter((mot) => mot.length > 3);
    const partageUnMot = motsAdresseSignificatifs.some((mot) => texteComplet.includes(mot));
    const partageVille = Boolean(ville) && texteComplet.includes(ville);

    if (partageUnMot || partageVille) {
      candidats.push({ bienId: bien.id, confidence: 0.6, matchedBy: "adresse_partielle" });
    }
  }

  return candidats;
}
