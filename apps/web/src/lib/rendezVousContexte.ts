import { rendezVousDuJour as rendezVousMock } from "@/data/agenda";
import { listerBiensActifsDuWorkspace } from "@/lib/bienRepository";
import { listerAcquereursActifsDuWorkspace } from "@/lib/clientRepository";
import type { RendezVous } from "@/types/agenda";
import type { ContexteRendezVous } from "@/types/contexteRendezVous";
import { construireContexte, type Referentiel } from "@/lib/matching";
import { resoudreContextePersiste } from "@/lib/contexteRepository";
import { lireConnexionGoogle } from "@/lib/google/connexion";
import { rafraichirAccessToken } from "@/lib/google/oauth";
import { recupererEvenement } from "@/lib/google/calendarClient";
import { toRendezVous } from "@/lib/google/adapter";

const PREFIXE_GOOGLE = "gcal-";

export type RendezVousAvecContexte = { rdv: RendezVous; contexte: ContexteRendezVous };

// Le pool de rapprochement, et lui seul : biens et acquéreurs ACTIFS du périmètre de session.
// Jamais un catalogue global filtré ensuite — un candidat d'un autre workspace ne doit pas même
// être évalué, puisque son seul score suffirait à rendre un bien ambigu et à changer le verdict.
async function chargerReferentiel(workspaceId: string): Promise<Referentiel> {
  const [biens, clients] = await Promise.all([
    listerBiensActifsDuWorkspace(workspaceId),
    listerAcquereursActifsDuWorkspace(workspaceId),
  ]);
  return { biens, clients };
}

// Couche dédiée : les appelants (ex. la page de préparation) ne connaissent que l'id d'un
// rendez-vous. La façon dont on retrouve le rendez-vous et son contexte métier — mock en
// mémoire, ré-appel à Google Calendar puis résolution via la mémoire persistée (ADR-006) —
// reste un détail d'implémentation qui peut évoluer sans jamais toucher les appelants.
//
// WORKSPACE_SCOPING_V2D1 (ADR-054) — `workspaceId` est OBLIGATOIRE, et il borne le RÉFÉRENTIEL de
// rapprochement, pas le résultat. C'est la seule forme correcte : le matching est textuel (une
// ville, un nom de famille suffisent à produire un candidat, voir lib/matching), donc deux agences
// d'une même ville ou deux homonymes collisionnent par construction. Filtrer après coup laisserait
// la paire exister — et la décision serait déjà écrite dans la mémoire contextuelle.
//
// Conséquence assumée : un même événement Calendar produit un contexte DIFFÉRENT selon le
// workspace de session. C'est correct, et c'est pourquoi la mémoire est désormais clée sur le
// triplet (workspace, source, identifiant externe) — migration 0055.
//
// WORKSPACE_SCOPING_V2D2 — DEUX périmètres, jamais confondus, et c'est pourquoi ce sont deux
// paramètres distincts plutôt qu'un seul « contexte » :
//
//   `workspaceId` borne les données DOMIORA — quels biens et quels acquéreurs peuvent être
//   rapprochés de cet événement (V2D1) ;
//   `identiteSub` borne le COMPTE GOOGLE — de quel agenda l'événement est lu.
//
// Les deux ne coïncident pas conceptuellement : un agenda appartient à une personne, un dossier à
// un workspace. Les fusionner reviendrait à faire d'un secret personnel un actif partagé, ce que
// l'ADR-054 §6 refuse explicitement. Avant ce lot, l'événement venait du singleton d'instance :
// c'était la dernière frontière ouverte du chantier.
export async function getRendezVousAvecContexte(
  rdvId: string,
  workspaceId: string,
  identiteSub: string
): Promise<RendezVousAvecContexte | undefined> {
  const rdvMock = rendezVousMock.find((r) => r.id === rdvId);
  if (rdvMock) {
    const referentiel = await chargerReferentiel(workspaceId);
    return { rdv: rdvMock, contexte: construireContexte(rdvMock, referentiel) };
  }

  if (!rdvId.startsWith(PREFIXE_GOOGLE)) return undefined;

  const connexion = await lireConnexionGoogle(identiteSub);
  if (!connexion) return undefined;

  try {
    const { accessToken } = await rafraichirAccessToken(connexion.refreshToken);
    const event = await recupererEvenement(accessToken, rdvId.slice(PREFIXE_GOOGLE.length));
    if (!event) return undefined;

    const rdv = toRendezVous(event);
    if (!rdv) return undefined;

    const referentiel = await chargerReferentiel(workspaceId);
    const contexte = await resoudreContextePersiste(rdv, referentiel, workspaceId);
    return { rdv, contexte };
  } catch (erreur) {
    console.error("[rendez-vous-contexte] échec de récupération :", erreur);
    return undefined;
  }
}
