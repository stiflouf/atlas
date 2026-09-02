"use server";

import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { assemblerFaits, LABEL_TON_MESSAGE, type TonMessage } from "@/lib/communications/contexteCommunication";
import {
  resoudreContexteEcranCommunication,
  trouverCandidatChoisi,
} from "@/lib/communications/contexteEcranCommunication";
import { projeterFaitsAutorises } from "@/lib/redaction/contrat";
import { reformulerBrouillon } from "@/lib/redaction/orchestration";
import { resoudreRedacteur } from "@/lib/redaction/redacteur";

// VALUE-05 — reformulation assistée. Deux invariants portent toute la sécurité de cette action :
//
// 1. AUCUN FAIT NE VIENT DU CLIENT. Le formulaire ne transmet que le texte visible à l'écran (que
//    le conseiller a le droit d'éditer), le ton, et les identifiants d'écran. Les faits autorisés
//    sont RÉSOLUS À NOUVEAU côté serveur par le même résolveur que la page, puis projetés sur la
//    liste blanche. Un champ posté à la main ne peut donc pas devenir un fait transmis au modèle.
//
// 2. AUCUN ENVOI. Cette action ne touche ni Gmail, ni le destinataire, ni une tâche, ni une
//    relance : elle rend deux chaînes de texte que le conseiller reste libre de modifier ou
//    d'ignorer.
export type ResultatActionReformulation =
  | { statut: "idle" }
  | { statut: "reformule"; objet: string; corps: string }
  // Une seule issue d'échec côté écran : le conseiller n'a pas à lire un motif technique, et son
  // brouillon est conservé dans tous les cas.
  | { statut: "indisponible" };

const TONS_VALIDES = Object.keys(LABEL_TON_MESSAGE) as TonMessage[];

function texte(valeur: FormDataEntryValue | null): string {
  return String(valeur ?? "");
}

function texteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const brut = texte(valeur).trim();
  return brut !== "" ? brut : undefined;
}

export async function reformulerBrouillonAction(
  _etatPrecedent: ResultatActionReformulation | null,
  formData: FormData
): Promise<ResultatActionReformulation> {
  await exigerSessionAtlas();

  const tonSoumis = texte(formData.get("ton"));
  const ton = TONS_VALIDES.includes(tonSoumis as TonMessage) ? (tonSoumis as TonMessage) : undefined;
  const objetActuel = texte(formData.get("objet")).trim();
  const corpsActuel = texte(formData.get("corps")).trim();
  if (!ton || objetActuel === "" || corpsActuel === "") return { statut: "indisponible" };

  // Mêmes identifiants d'écran que la page, revalidés par le même résolveur : un lien ou un champ
  // forgé ne donne accès à aucun contexte que la page n'aurait pas elle-même produit.
  const contexteEcran = await resoudreContexteEcranCommunication({
    tacheId: texteOptionnel(formData.get("tacheId")),
    bienId: texteOptionnel(formData.get("bienId")),
    acquereurId: texteOptionnel(formData.get("acquereurId")),
    exigenceCode: texteOptionnel(formData.get("exigenceCode")),
    notaire: texteOptionnel(formData.get("notaire")),
    candidat: texteOptionnel(formData.get("candidat")),
  });
  if (!contexteEcran) return { statut: "indisponible" };

  const candidat =
    contexteEcran.candidats.length === 1
      ? contexteEcran.candidats[0]
      : trouverCandidatChoisi(contexteEcran.candidats, texteOptionnel(formData.get("candidat")));

  const resultat = await reformulerBrouillon(resoudreRedacteur(), {
    ton,
    // Seul un prospect vendeur est propriétaire du bien du dossier (ADR-027). Un acquéreur, un
    // notaire ou un destinataire non résolu ne l'est pas : le repli est donc `false`, jamais une
    // supposition favorable.
    destinataireEstProprietaire: candidat?.type === "prospectVendeur",
    // Le texte présent dans l'éditeur, y compris déjà modifié à la main : c'est lui que le
    // conseiller veut voir reformulé. Il ne fait entrer aucune donnée CRM supplémentaire — il est
    // déjà sorti du serveur une première fois, validé par la même chaîne.
    objetActuel,
    corpsActuel,
    faitsAutorises: projeterFaitsAutorises(assemblerFaits(candidat, contexteEcran.faits)),
  });

  if (resultat.type !== "reformule") return { statut: "indisponible" };
  return { statut: "reformule", objet: resultat.objet, corps: resultat.corps };
}
