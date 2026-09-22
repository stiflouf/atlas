"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { creerAcquereur } from "@/lib/clientRepository";
import { creerContact } from "@/lib/contactRepository";
import { creerProjetAcquereur } from "@/lib/projetAcquereurRepository";
import { ajouterPartieProjet } from "@/lib/partieProjetRepository";
import { parseAcquereurFormData } from "@/lib/acquereurFormulaire";
import { enqueuerResynchronisationAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// Création + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) — un acquéreur tout
// juste créé peut déjà être compatible avec des biens existants, une vraie opportunité (pas une
// baseline) — voir creerBienAction pour le raisonnement symétrique complet.
export async function creerAcquereurAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const { idDemandeResynchronisation } = await getDb().transaction(async (tx) => {
      const donnees = parseAcquereurFormData(formData);
      // ADR-055 — l'identité canonique est créée DANS LA MÊME TRANSACTION que le dossier qui la
      // référence : les deux existent ensemble ou aucun des deux. Toujours un nouveau contact, jamais
      // un rapprochement automatique avec un contact existant — deux personnes mal saisies partageant
      // un email ne doivent jamais être fusionnées sans décision humaine (ADR-055 §H). Un doublon se
      // corrige ; une fusion à tort, non.
      //
      // Le dossier reste la SOURCE DE VÉRITÉ du workflow : rien ne lit encore `contacts`, aucun écran
      // ne change. Le contact est une identité canonique parallèle, alimentée à partir d'aujourd'hui.
      const contact = await creerContact(
        { nom: donnees.nom, prenom: donnees.prenom, email: donnees.email, telephone: donnees.telephone },
        workspaceId,
        tx
      );
      // ADR-055 §B — le PROJET canonique et la PARTIE qui l'attache à la personne, dans la même
      // transaction que le reste. Le rôle n'est pas une colonne du contact : c'est cette
      // participation qui fait de cette personne un acquéreur. `acquereur` (et non `co_acquereur`)
      // parce que la ligne historique ne décrit qu'une identité — celle du porteur principal.
      //
      // Un seul `tx` du début à la fin : contact, projet, partie, dossier historique et demande de
      // resynchronisation existent tous ou aucun. Aucune transaction imbriquée, aucune compensation
      // à écrire — un échec à n'importe quelle étape ne laisse pas de personne sans projet ni de
      // projet sans porteur.
      const projet = await creerProjetAcquereur(donnees, workspaceId, tx);
      await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projet.id, role: "acquereur" }, tx);

      const acquereur = await creerAcquereur(
        { ...donnees, contactId: contact.id, projetAcquereurId: projet.id },
        workspaceId,
        tx
      );
      const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, workspaceId, tx);
      return { acquereur, idDemandeResynchronisation };
    });

    await traiterDemandeResynchronisation(idDemandeResynchronisation);
    redirect("/clients");
  });
}
