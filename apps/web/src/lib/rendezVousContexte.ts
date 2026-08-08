import { rendezVousDuJour as rendezVousMock } from "@/data/agenda";
import { biens } from "@/data/biens";
import { clients } from "@/data/clients";
import type { RendezVous } from "@/types/agenda";
import type { ContexteRendezVous } from "@/types/contexteRendezVous";
import { construireContexte } from "@/lib/matching";
import { lireTokens } from "@/lib/google/tokens";
import { rafraichirAccessToken } from "@/lib/google/oauth";
import { recupererEvenement } from "@/lib/google/calendarClient";
import { toRendezVous } from "@/lib/google/adapter";

const PREFIXE_GOOGLE = "gcal-";

export type RendezVousAvecContexte = { rdv: RendezVous; contexte: ContexteRendezVous };

// Couche dédiée : les appelants (ex. la page de préparation) ne connaissent que l'id d'un
// rendez-vous. La façon dont on retrouve le rendez-vous et son contexte métier — mock en
// mémoire aujourd'hui, ré-appel à Google Calendar pour un événement réel, autre chose demain —
// reste un détail d'implémentation qui peut évoluer sans jamais toucher les appelants.
export async function getRendezVousAvecContexte(rdvId: string): Promise<RendezVousAvecContexte | undefined> {
  const rdvMock = rendezVousMock.find((r) => r.id === rdvId);
  if (rdvMock) {
    return { rdv: rdvMock, contexte: construireContexte(rdvMock, { biens, clients }) };
  }

  if (!rdvId.startsWith(PREFIXE_GOOGLE)) return undefined;

  const tokens = await lireTokens();
  if (!tokens) return undefined;

  try {
    const { accessToken } = await rafraichirAccessToken(tokens.refreshToken);
    const event = await recupererEvenement(accessToken, rdvId.slice(PREFIXE_GOOGLE.length));
    if (!event) return undefined;

    const rdv = toRendezVous(event);
    if (!rdv) return undefined;

    return { rdv, contexte: construireContexte(rdv, { biens, clients }) };
  } catch (erreur) {
    console.error("[rendez-vous-contexte] échec de récupération :", erreur);
    return undefined;
  }
}
