import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { RendezVous } from "@/types/agenda";
import type { CandidatBien, CandidatClient, ContexteRendezVous } from "@/types/contexteRendezVous";
import { matcherBien } from "./matchBien";
import { matcherClient } from "./matchClient";
import { matcherType } from "./matchType";
import { calculerConfianceGlobale, resoudreBien, resoudreClient } from "./resoudre";

export type Referentiel = { biens: Bien[]; clients: ProfilAcquereur[] };

// Point d'entrée du moteur de correspondance : transforme un RendezVous (mock ou Google
// Calendar) en ContexteRendezVous. La donnée Google/mock reste intacte — cet objet est
// entièrement dérivé, recalculé à la demande, jamais persisté.
export function construireContexte(rdv: RendezVous, referentiel: Referentiel): ContexteRendezVous {
  const candidatsBien: CandidatBien[] = rdv.bien
    ? [{ bienId: rdv.bien.id, confidence: 1, matchedBy: "assignation_directe" }]
    : matcherBien(rdv, referentiel.biens);

  const candidatsClient: CandidatClient[] = rdv.client
    ? [{ clientId: rdv.client.id, confidence: 1, matchedBy: "assignation_directe" }]
    : matcherClient(rdv, referentiel.clients);

  const { bien, bienCandidats, necessiteConfirmationBien } = resoudreBien(candidatsBien);
  const client = resoudreClient(candidatsClient);
  const typeMetier = matcherType(rdv);

  return {
    rendezVousId: rdv.id,
    bien,
    bienCandidats,
    client,
    typeMetier,
    necessiteConfirmationBien,
    overallConfidence: calculerConfianceGlobale(bien, client, typeMetier),
  };
}
