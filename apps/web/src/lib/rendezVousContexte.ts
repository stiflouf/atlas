import { rendezVousDuJour as rendezVousMock } from "@/data/agenda";
import { listerBiens } from "@/lib/bienRepository";
import { listerClients } from "@/lib/clientRepository";
import type { RendezVous } from "@/types/agenda";
import type { ContexteRendezVous } from "@/types/contexteRendezVous";
import { construireContexte } from "@/lib/matching";
import { resoudreContextePersiste } from "@/lib/contexteRepository";
import { lireConnexionGoogle } from "@/lib/google/connexion";
import { rafraichirAccessToken } from "@/lib/google/oauth";
import { recupererEvenement } from "@/lib/google/calendarClient";
import { toRendezVous } from "@/lib/google/adapter";

const PREFIXE_GOOGLE = "gcal-";

export type RendezVousAvecContexte = { rdv: RendezVous; contexte: ContexteRendezVous };

// Couche dédiée : les appelants (ex. la page de préparation) ne connaissent que l'id d'un
// rendez-vous. La façon dont on retrouve le rendez-vous et son contexte métier — mock en
// mémoire, ré-appel à Google Calendar puis résolution via la mémoire persistée (ADR-006) —
// reste un détail d'implémentation qui peut évoluer sans jamais toucher les appelants.
export async function getRendezVousAvecContexte(rdvId: string): Promise<RendezVousAvecContexte | undefined> {
  const rdvMock = rendezVousMock.find((r) => r.id === rdvId);
  if (rdvMock) {
    const [biens, clients] = await Promise.all([listerBiens(), listerClients()]);
    return { rdv: rdvMock, contexte: construireContexte(rdvMock, { biens, clients }) };
  }

  if (!rdvId.startsWith(PREFIXE_GOOGLE)) return undefined;

  const connexion = await lireConnexionGoogle();
  if (!connexion) return undefined;

  try {
    const { accessToken } = await rafraichirAccessToken(connexion.refreshToken);
    const event = await recupererEvenement(accessToken, rdvId.slice(PREFIXE_GOOGLE.length));
    if (!event) return undefined;

    const rdv = toRendezVous(event);
    if (!rdv) return undefined;

    const [biens, clients] = await Promise.all([listerBiens(), listerClients()]);
    const contexte = await resoudreContextePersiste(rdv, { biens, clients });
    return { rdv, contexte };
  } catch (erreur) {
    console.error("[rendez-vous-contexte] échec de récupération :", erreur);
    return undefined;
  }
}
