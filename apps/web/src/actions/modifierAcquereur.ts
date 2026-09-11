"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { modifierAcquereur } from "@/lib/clientRepository";
import { resoudreSourceCriteres } from "@/lib/criteresAcquereurEffectifs";
import { modifierCriteresProjetAcquereur } from "@/lib/projetAcquereurRepository";
import { verrouillerChamp } from "@/lib/provenance/champVerrouilleRepository";
import { parseAcquereurFormData } from "@/lib/acquereurFormulaire";
import { enqueuerResynchronisationAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import type { NouvelAcquereur } from "@/lib/clientRepository";
import type { CriteresAcquereur } from "@/lib/criteresAcquereurEffectifs";

// ADR-056 §4 — les champs du projet qu'une source externe peut proposer, et donc les seuls qu'une
// correction humaine ait un sens à verrouiller. Mêmes noms canoniques que
// `CHAMPS_VERROUILLABLES.projet_acquereur`, parce que c'est le même vocabulaire.
const CHAMPS_CRITERES = [
  "budgetMin",
  "budgetMax",
  "criteres",
  "piecesMin",
  "surfaceMin",
  "accessibiliteRequise",
  "necessiteParking",
  "necessiteExterieur",
] as const;

function valeurChangee(avant: unknown, apres: unknown): boolean {
  if (Array.isArray(avant) || Array.isArray(apres)) return JSON.stringify(avant) !== JSON.stringify(apres);
  return avant !== apres;
}

// Quels critères cette saisie a réellement CHANGÉS. ADR-056 définit l'override local comme « une
// valeur modifiée par un humain » : rouvrir un formulaire et le réenregistrer à l'identique n'est
// pas une correction, et verrouillerait sinon les huit champs d'un coup — un connecteur ne pourrait
// plus jamais rien alimenter, sans que personne ne l'ait décidé.
function criteresModifies(avant: CriteresAcquereur, apres: NouvelAcquereur): string[] {
  return CHAMPS_CRITERES.filter((champ) => valeurChangee(avant[champ], apres[champ]));
}

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès après une
// modification qui n'a en réalité touché aucune ligne.
//
// UNE SEULE TRANSACTION pour tout (ADR-036) : source de vérité résolue, projet canonique écrit,
// dossier écrit, verrous humains posés, demande de resynchronisation enregistrée. Un formulaire
// touche à la fois des champs du dossier et des critères du projet — les écrire en deux temps
// laisserait un état où le produit affiche un budget que le matching ignore encore.
export async function modifierAcquereurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  // ADR-054 — appartenance explicite de la demande de resynchronisation (table racine) et périmètre
  // vérifié par les primitives canoniques : `verrouillerChamp` refuse une cible d'un autre
  // workspace, et le projet est atteint par la FK du dossier, jamais par une recherche.
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const donnees = parseAcquereurFormData(formData);

  const resultat = await getDb().transaction(async (tx) => {
    // Résolue DANS la transaction : décider d'après un pont lu avant elle reviendrait à écrire sur
    // la foi d'un état périmé. Lève si la référence est cassée — fail closed, jamais un repli
    // silencieux vers le dossier.
    const source = await resoudreSourceCriteres(id, tx);

    if (source.source === "dossier") {
      // Acquéreur historique : comportement strictement inchangé. Aucun Contact, aucun projet
      // canonique n'est créé au passage — le rattachement de l'historique est un geste explicite,
      // réservé à son propre lot (ADR-055, stratégie de migration).
      const acquereur = await modifierAcquereur(id, donnees, "dossier", tx);
      if (!acquereur) return undefined;
      const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, workspaceId, tx);
      return { acquereur, idDemandeResynchronisation };
    }

    const projet = await modifierCriteresProjetAcquereur(source.projetAcquereurId, donnees, tx);
    // Le Core a refusé un invariant que le formulaire laissait passer. Rien n'est persisté, et
    // surtout rien n'est « réparé » : la transaction entière est abandonnée.
    if (!projet) throw new Error("Le Core refuse ces critères : budget minimum supérieur au maximum.");

    const acquereur = await modifierAcquereur(id, donnees, "projet_canonique", tx);
    if (!acquereur) return undefined;

    // ADR-056 §4 — l'override local. Une valeur corrigée par un humain n'est plus jamais réécrite
    // par une synchronisation, et seul un geste humain explicite lèvera le verrou.
    for (const champ of criteresModifies(source.criteres, donnees)) {
      await verrouillerChamp({ type: "projet_acquereur", id: source.projetAcquereurId }, champ, workspaceId, tx);
    }

    const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, workspaceId, tx);
    return { acquereur, idDemandeResynchronisation };
  });
  if (!resultat) notFound();

  await traiterDemandeResynchronisation(resultat.idDemandeResynchronisation);
  redirect(`/clients/${resultat.acquereur.id}`);
}
