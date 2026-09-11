"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { modifierAcquereur } from "@/lib/clientRepository";
import { modifierIdentiteContact } from "@/lib/contactRepository";
import { resoudreSourceCriteres } from "@/lib/criteresAcquereurEffectifs";
import { resoudreSourceIdentiteAcquereur } from "@/lib/identiteContactEffective";
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
// correction humaine ait un sens à verrouiller ici. Le verrou des champs d'IDENTITÉ est posé par
// `modifierIdentiteContact` lui-même : cette primitive-là est humaine par construction, alors que
// `modifierChampProjetAcquereur` est partagée avec l'import et ne peut pas savoir qui l'appelle.
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
// UNE SEULE TRANSACTION pour tout (ADR-036) : sources de vérité résolues, Contact écrit, projet
// canonique écrit, dossier écrit, verrous humains posés, demande de resynchronisation enregistrée.
// Un formulaire touche à la fois l'identité, les critères et le parcours — les écrire en plusieurs
// temps laisserait un état où le produit affiche une chose et en envoie une autre.
//
// DEUX PONTS INDÉPENDANTS (ADR-055 §B pour les critères, ADR-057 pour l'identité) : un dossier peut
// être rattaché à un Contact sans projet canonique, ou l'inverse. Chacun est résolu et appliqué
// séparément ; aucun ne complète l'autre.
export async function modifierAcquereurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  // ADR-054 — périmètre du dossier modifié, de la demande de resynchronisation et des verrous.
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const donnees = parseAcquereurFormData(formData);

  const resultat = await getDb().transaction(async (tx) => {
    // Résolues DANS la transaction : décider d'après un pont lu avant elle reviendrait à écrire sur
    // la foi d'un état périmé. Lèvent si une référence est cassée — fail closed, jamais un repli
    // silencieux vers le dossier.
    const [sourceCriteres, sourceIdentite] = await Promise.all([
      resoudreSourceCriteres(id, tx),
      resoudreSourceIdentiteAcquereur(id, tx),
    ]);

    if (sourceCriteres.source === "projet") {
      const projet = await modifierCriteresProjetAcquereur(sourceCriteres.projetAcquereurId, donnees, tx);
      // Le Core a refusé un invariant que le formulaire laissait passer. Rien n'est persisté, et
      // surtout rien n'est « réparé » : la transaction entière est abandonnée.
      if (!projet) throw new Error("Le Core refuse ces critères : budget minimum supérieur au maximum.");

      // ADR-056 §4 — l'override local sur les critères. Le verrou d'identité, lui, est posé par
      // `modifierIdentiteContact`.
      for (const champ of criteresModifies(sourceCriteres.criteres, donnees)) {
        await verrouillerChamp({ type: "projet_acquereur", id: sourceCriteres.projetAcquereurId }, champ, workspaceId, tx);
      }
    }

    if (sourceIdentite.source === "contact") {
      // ADR-057 — le Contact fait foi : l'identité ne part QUE là. Les colonnes du dossier restent
      // l'instantané de sa création, et le writer legacy ci-dessous ne les touche pas.
      const contact = await modifierIdentiteContact(
        sourceIdentite.contactId,
        {
          nom: donnees.nom,
          // FRONTIÈRE DE FORMULAIRE, et le seul endroit où elle a le droit d'exister. Un input HTML
          // vide arrive en chaîne vide ; les colonnes du DOSSIER sont NOT NULL et s'en accommodent,
          // celles du Contact sont nullables et doivent recevoir une ABSENCE. Écrire `""` dans
          // `contacts.prenom` déguiserait un champ non renseigné en valeur — exactement la dette que
          // ce lot ferme côté lecture, réintroduite côté écriture.
          prenom: donnees.prenom || undefined,
          email: donnees.email || undefined,
          telephone: donnees.telephone || undefined,
        },
        workspaceId,
        tx
      );
      if (!contact) throw new Error("Contact canonique introuvable pour cet acquéreur.");
    }

    // Aucun Contact, aucun projet canonique n'est créé au passage pour un dossier historique — le
    // rattachement de l'historique est un geste explicite, réservé à son propre lot (ADR-055,
    // stratégie de migration ; ADR-057 décision 6).
    const acquereur = await modifierAcquereur(
      id,
      donnees,
      {
        criteres: sourceCriteres.source === "projet" ? "projet_canonique" : "dossier",
        identite: sourceIdentite.source === "contact" ? "contact_canonique" : "dossier",
      },
      workspaceId,
      tx
    );
    if (!acquereur) return undefined;

    const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, workspaceId, tx);
    return { acquereur, idDemandeResynchronisation };
  });
  if (!resultat) notFound();

  await traiterDemandeResynchronisation(resultat.idDemandeResynchronisation);
  redirect(`/clients/${resultat.acquereur.id}`);
}
