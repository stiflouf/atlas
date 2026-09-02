"use server";

import { redirect } from "next/navigation";
import { getVisiteById } from "@/lib/visiteRepository";
import { getCompteRenduVisiteParVisiteId } from "@/lib/compteRenduVisiteRepository";
import { getClientById } from "@/lib/clientRepository";
import { getBienById } from "@/lib/bienRepository";
import { creerTache, getTachesPourAcquereur } from "@/lib/tacheRepository";
import { titreTacheProchaineEtape } from "@/lib/visites/suiteVisite";
import { deriverStatutTache } from "@/types/tache";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

// VALUE-02 — promotion EXPLICITE d'une prochaine étape en tâche. Jamais déclenchée par
// l'enregistrement du compte rendu, jamais par un GET : uniquement par ce geste dédié du
// conseiller (même discipline qu'ADR-041, qui a supprimé le dernier GET-mutant du produit).
//
// Le texte est relu depuis le compte rendu PERSISTÉ, jamais accepté depuis le client : le
// formulaire ne transmet que l'identifiant de la visite. Un libellé arbitraire posté à la main ne
// peut donc pas devenir une tâche.
//
// Aucune interprétation du texte : ni date, ni priorité, ni type déduits de son contenu. « vendredi »
// dans « Recontacter Camille vendredi » ne devient jamais une échéance — la tâche est créée sans
// échéance, le conseiller la fixe s'il le souhaite.
export async function creerTacheProchaineEtapeAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const visiteId = String(formData.get("visiteId") ?? "");
  if (!visiteId) redirect("/");

  const visite = await getVisiteById(visiteId);
  if (!visite) redirect("/");

  const [compteRendu, acquereur, bien] = await Promise.all([
    getCompteRenduVisiteParVisiteId(visite.id),
    getClientById(visite.acquereurId),
    getBienById(visite.bienId),
  ]);

  const prochaineEtape = compteRendu?.prochaineEtape?.trim();
  // Rien à promouvoir, ou dossier sorti des flux actifs (ADR-012) : aucun effet, jamais une erreur
  // bloquante — le conseiller revient simplement sur sa fiche.
  if (prochaineEtape && acquereur && !acquereur.archiveLe && bien && !bien.archiveLe) {
    const titre = titreTacheProchaineEtape(prochaineEtape);
    const dejaOuverte = (await getTachesPourAcquereur(acquereur.id)).some(
      (t) => deriverStatutTache(t) === "a_faire" && t.titre === titre
    );
    // Garde d'idempotence : double clic, retour arrière, re-soumission — jamais deux tâches pour
    // la même prochaine étape.
    if (!dejaOuverte) {
      await creerTache({
        titre,
        // Le contexte situe l'origine sans reformuler la prochaine étape ni le retour de visite.
        contexte: `Prochaine étape issue du compte rendu de visite de ${bien.reference}.`,
        type: "relance",
        priorite: "normale",
        origine: "manuelle",
        // Cible acquéreur, conformément à ADR-041 : une action de suivi vise une personne. C'est
        // aussi ce qui permet à VALUE-01 d'absorber l'opportunité transversale équivalente.
        cible: { type: "acquereur", id: acquereur.id },
      });
    }
  }

  redirect(`/visites/${visite.id}`);
}
