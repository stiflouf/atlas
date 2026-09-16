import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  contactFusions as contactFusionsTable,
  contacts as contactsTable,
  interactions as interactionsTable,
  partiesProjet as partiesProjetTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
  prospectsVendeurs as prospectsVendeursTable,
} from "@/db/schema";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import type { StadeProjet } from "@/types/client";
import type { Contact } from "@/types/contact";
import type { SensInteraction, TypeInteraction } from "@/types/interaction";
import { estContactFusionne } from "@/lib/contactFusion";
import { resoudreContactActif } from "@/lib/contactRepository";
import type { RoleContact } from "@/types/rechercheContact";
import type {
  ContactDetail,
  ResultatContactDetail,
  ContexteInteractionRecente,
  DossierAcquereurContactOnly,
  DossierVendeurContactOnly,
  FusionAbsorbeeContact,
  ProjetAcquereurDetail,
  ProjetVendeurDetail,
} from "@/types/contactDetail";

// ADR-058 — LE READ MODEL DE LA FICHE CONTACT. Six requêtes, quel que soit le nombre de projets,
// de dossiers, d'interactions ou de fusions : le contact, les participations avec leurs projets,
// les dossiers historiques rattachés (acquéreurs, prospects), les dernières interactions, les
// anciennes fiches absorbées. Jamais une requête par projet.
//
// Ce module ne rapproche rien par nom, email ou téléphone : un dossier n'entre dans cette fiche que
// par une clé réelle — `contact_id` posé par un humain (ADR-055 §H), ou `projet_*_id` vers un projet
// auquel le contact participe. Une interaction n'y entre que par `contact_id` exact.
//
// ADR-059 — un contact ABSORBÉ ne charge aucun historique (il appartient au survivant) : son état
// est rendu tel quel (`type: "fusionne"`) avec le contact actif FINAL, résolu par la seule primitive
// de parcours du produit (`resoudreContactActif`, bornée, sans compaction). Une chaîne invalide
// (cycle, profondeur, maillon manquant) est une corruption, pas une absence : erreur contrôlée,
// jamais un 404 qui la cacherait ni un lien fabriqué.
//
// ADR-059 — les fiches ABSORBÉES dans ce contact viennent du JOURNAL `contact_fusions` (quoi, quand,
// qui, identité avant), jamais de `contacts.fusionne_dans_contact_id`, qui ne dit que l'état courant
// et sert la navigation. Fusions DIRECTES seulement, sans suivre la chaîne ; l'identité est celle du
// journal, sans joindre la ligne de l'absorbé. Un absorbé sans ligne journal n'est pas inventé.
//
// Lecture seule ; aucun chemin d'écriture n'est importé.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Assez pour lire la relation d'un coup d'œil, pas la timeline entière (ADR-055 §G).
export const LIMITE_INTERACTIONS_RECENTES = 10;

function localisationProspect(ligne: {
  ville: string | null;
  secteurBienPotentiel: string | null;
  adresseBienPotentiel: string | null;
}): string | undefined {
  return ligne.ville ?? ligne.secteurBienPotentiel ?? ligne.adresseBienPotentiel ?? undefined;
}

function contexteInteraction(ligne: {
  projetAcquereurId: string | null;
  projetVendeurId: string | null;
  bienId: string | null;
}): ContexteInteractionRecente | undefined {
  if (ligne.projetAcquereurId) return "projet_acquereur";
  if (ligne.projetVendeurId) return "projet_vendeur";
  if (ligne.bienId) return "bien";
  return undefined;
}

// Le journal n'a pas de `workspace_id` (feuille de `contacts`, ADR-054 §7) : le périmètre est celui
// du survivant, vérifié DANS la requête par la jointure — pas seulement par l'appelant. Ordre
// déterministe : la fusion la plus récente d'abord, `id` en départage.
export async function listerFusionsAbsorbees(
  contactSurvivantId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<FusionAbsorbeeContact[]> {
  if (!UUID_REGEX.test(contactSurvivantId)) return [];
  const lignes = await executeur
    .select({
      fusionId: contactFusionsTable.id,
      contactAbsorbeId: contactFusionsTable.contactAbsorbeId,
      identiteAvantAbsorbe: contactFusionsTable.identiteAvantAbsorbe,
      fusionneLe: contactFusionsTable.fusionneLe,
      fusionneParEmail: contactFusionsTable.fusionneParEmail,
    })
    .from(contactFusionsTable)
    .innerJoin(
      contactsTable,
      and(eq(contactsTable.id, contactFusionsTable.contactSurvivantId), eq(contactsTable.workspaceId, workspaceId))
    )
    .where(eq(contactFusionsTable.contactSurvivantId, contactSurvivantId))
    .orderBy(desc(contactFusionsTable.fusionneLe), desc(contactFusionsTable.id));
  return lignes.map((ligne) => ({
    fusionId: ligne.fusionId,
    contactAbsorbeId: ligne.contactAbsorbeId,
    identiteAbsorbee: ligne.identiteAvantAbsorbe,
    fusionneLe: ligne.fusionneLe.toISOString(),
    fusionneParEmail: ligne.fusionneParEmail ?? undefined,
  }));
}

export async function chargerContactDetail(
  contactId: string,
  // ADR-054 — OBLIGATOIRE : un contact d'un autre workspace est introuvable, pas interdit — rien ne
  // doit permettre d'inférer son existence.
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatContactDetail | undefined> {
  if (!UUID_REGEX.test(contactId)) return undefined;

  // REQUÊTE 1 — le contact, dans son périmètre.
  const [contact] = await executeur
    .select()
    .from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!contact) return undefined;

  const identite: Contact = {
    id: contact.id,
    nom: contact.nom,
    prenom: contact.prenom ?? undefined,
    email: contact.email ?? undefined,
    telephone: contact.telephone ?? undefined,
    creeLe: contact.creeLe.toISOString(),
    modifieLe: contact.modifieLe.toISOString(),
    fusionneDansContactId: contact.fusionneDansContactId ?? undefined,
    fusionneLe: contact.fusionneLe?.toISOString(),
  };
  if (estContactFusionne(identite)) {
    const resolution = await resoudreContactActif(identite.id, workspaceId, executeur);
    if (resolution.statut !== "actif") {
      throw new Error(`Chaîne de fusion invalide pour le contact ${identite.id}`);
    }
    return {
      type: "fusionne",
      contact: identite,
      fusionneDansContactId: identite.fusionneDansContactId,
      contactActifId: resolution.contact.id,
      fusionneLe: identite.fusionneLe,
    };
  }

  // REQUÊTE 2 — les participations et leurs projets, en une jointure.
  const participations = await executeur
    .select({
      projetAcquereurId: projetsAcquereurTable.id,
      stade: projetsAcquereurTable.stadeProjet,
      budgetMin: projetsAcquereurTable.budgetMin,
      budgetMax: projetsAcquereurTable.budgetMax,
      criteres: projetsAcquereurTable.criteres,
      acquereurCreeLe: projetsAcquereurTable.creeLe,
      acquereurArchiveLe: projetsAcquereurTable.archiveLe,
      projetVendeurId: projetsVendeurTable.id,
      vendeurCreeLe: projetsVendeurTable.creeLe,
      vendeurArchiveLe: projetsVendeurTable.archiveLe,
      datePerte: projetsVendeurTable.datePerte,
      mandatSigneLe: projetsVendeurTable.mandatSigneLe,
      mandatProposeLe: projetsVendeurTable.mandatProposeLe,
      estimationProposeeLe: projetsVendeurTable.estimationProposeeLe,
      rdvEstimationRealiseLe: projetsVendeurTable.rdvEstimationRealiseLe,
      qualifieLe: projetsVendeurTable.qualifieLe,
    })
    .from(partiesProjetTable)
    .leftJoin(projetsAcquereurTable, eq(partiesProjetTable.projetAcquereurId, projetsAcquereurTable.id))
    .leftJoin(projetsVendeurTable, eq(partiesProjetTable.projetVendeurId, projetsVendeurTable.id))
    .where(eq(partiesProjetTable.contactId, contactId))
    .orderBy(asc(projetsAcquereurTable.creeLe), asc(projetsVendeurTable.creeLe));

  const projetsAcquereur = new Map<string, ProjetAcquereurDetail>();
  const projetsVendeur = new Map<string, ProjetVendeurDetail>();
  for (const ligne of participations) {
    if (ligne.projetAcquereurId) {
      projetsAcquereur.set(ligne.projetAcquereurId, {
        projetId: ligne.projetAcquereurId,
        stade: ligne.stade as StadeProjet,
        budgetMin: ligne.budgetMin!,
        budgetMax: ligne.budgetMax!,
        criteres: ligne.criteres ?? [],
        creeLe: ligne.acquereurCreeLe!.toISOString(),
        archiveLe: ligne.acquereurArchiveLe?.toISOString(),
      });
    }
    if (ligne.projetVendeurId) {
      projetsVendeur.set(ligne.projetVendeurId, {
        projetId: ligne.projetVendeurId,
        // La cascade métier, appelée sur les jalons bruts — jamais réécrite (ADR-014).
        statut: deriverStatutProspectVendeur({
          datePerte: ligne.datePerte ?? undefined,
          mandatSigneLe: ligne.mandatSigneLe?.toISOString(),
          mandatProposeLe: ligne.mandatProposeLe?.toISOString(),
          estimationProposeeLe: ligne.estimationProposeeLe ?? undefined,
          rdvEstimationRealiseLe: ligne.rdvEstimationRealiseLe?.toISOString(),
          qualifieLe: ligne.qualifieLe?.toISOString(),
        }),
        creeLe: ligne.vendeurCreeLe!.toISOString(),
        archiveLe: ligne.vendeurArchiveLe?.toISOString(),
      });
    }
  }

  // REQUÊTES 3, 4, 5 et 6 — dossiers historiques rattachés, dernières interactions et fiches
  // absorbées, en parallèle. Un dossier est retenu par `contact_id`, ou parce qu'il décrit un projet
  // du contact : dans les deux cas une clé réelle, jamais une ressemblance.
  const idsProjetsAcquereur = [...projetsAcquereur.keys()];
  const idsProjetsVendeur = [...projetsVendeur.keys()];
  const [dossiersAcquereur, dossiersVendeur, interactions, fusionsAbsorbees] = await Promise.all([
    executeur
      .select({
        id: acquereursTable.id,
        projetAcquereurId: acquereursTable.projetAcquereurId,
        stade: acquereursTable.stadeProjet,
        budgetMin: acquereursTable.budgetMin,
        budgetMax: acquereursTable.budgetMax,
        archiveLe: acquereursTable.archiveLe,
      })
      .from(acquereursTable)
      .where(
        and(
          eq(acquereursTable.workspaceId, workspaceId),
          idsProjetsAcquereur.length > 0
            ? or(eq(acquereursTable.contactId, contactId), inArray(acquereursTable.projetAcquereurId, idsProjetsAcquereur))
            : eq(acquereursTable.contactId, contactId)
        )
      )
      .orderBy(asc(acquereursTable.creeLe), asc(acquereursTable.id)),
    executeur
      .select({
        id: prospectsVendeursTable.id,
        projetVendeurId: prospectsVendeursTable.projetVendeurId,
        ville: prospectsVendeursTable.ville,
        secteurBienPotentiel: prospectsVendeursTable.secteurBienPotentiel,
        adresseBienPotentiel: prospectsVendeursTable.adresseBienPotentiel,
        archiveLe: prospectsVendeursTable.archiveLe,
        datePerte: prospectsVendeursTable.datePerte,
        mandatSigneLe: prospectsVendeursTable.mandatSigneLe,
        mandatProposeLe: prospectsVendeursTable.mandatProposeLe,
        estimationProposeeLe: prospectsVendeursTable.estimationProposeeLe,
        rdvEstimationRealiseLe: prospectsVendeursTable.rdvEstimationRealiseLe,
        qualifieLe: prospectsVendeursTable.qualifieLe,
      })
      .from(prospectsVendeursTable)
      .where(
        and(
          eq(prospectsVendeursTable.workspaceId, workspaceId),
          idsProjetsVendeur.length > 0
            ? or(
                eq(prospectsVendeursTable.contactId, contactId),
                inArray(prospectsVendeursTable.projetVendeurId, idsProjetsVendeur)
              )
            : eq(prospectsVendeursTable.contactId, contactId)
        )
      )
      .orderBy(asc(prospectsVendeursTable.creeLe), asc(prospectsVendeursTable.id)),
    executeur
      .select({
        id: interactionsTable.id,
        type: interactionsTable.type,
        sens: interactionsTable.sens,
        survenuLe: interactionsTable.survenuLe,
        projetAcquereurId: interactionsTable.projetAcquereurId,
        projetVendeurId: interactionsTable.projetVendeurId,
        bienId: interactionsTable.bienId,
      })
      .from(interactionsTable)
      .where(eq(interactionsTable.contactId, contactId))
      // Même ordre total que listerInteractionsDuContact : date métier, puis ce que DOMIORA a su en
      // dernier, puis l'id.
      .orderBy(desc(interactionsTable.survenuLe), desc(interactionsTable.creeLe), asc(interactionsTable.id))
      .limit(LIMITE_INTERACTIONS_RECENTES),
    listerFusionsAbsorbees(contactId, workspaceId, executeur),
  ]);

  // PONT ou CONTACT-ONLY, jamais les deux : un dossier qui décrit un projet du contact est porté
  // par ce projet ; les autres sont listés à part. Aucun dossier n'est perdu.
  const dossiersAcquereurContactOnly: DossierAcquereurContactOnly[] = [];
  for (const dossier of dossiersAcquereur) {
    const projet = dossier.projetAcquereurId ? projetsAcquereur.get(dossier.projetAcquereurId) : undefined;
    if (projet) {
      projet.acquereurId ??= dossier.id;
    } else {
      dossiersAcquereurContactOnly.push({
        acquereurId: dossier.id,
        stade: dossier.stade as StadeProjet,
        budgetMin: dossier.budgetMin,
        budgetMax: dossier.budgetMax,
        archiveLe: dossier.archiveLe?.toISOString(),
      });
    }
  }

  const dossiersVendeurContactOnly: DossierVendeurContactOnly[] = [];
  for (const dossier of dossiersVendeur) {
    const projet = dossier.projetVendeurId ? projetsVendeur.get(dossier.projetVendeurId) : undefined;
    if (projet) {
      if (!projet.prospectVendeurId) {
        projet.prospectVendeurId = dossier.id;
        projet.localisation = localisationProspect(dossier);
      }
    } else {
      dossiersVendeurContactOnly.push({
        prospectVendeurId: dossier.id,
        statut: deriverStatutProspectVendeur({
          datePerte: dossier.datePerte ?? undefined,
          mandatSigneLe: dossier.mandatSigneLe?.toISOString(),
          mandatProposeLe: dossier.mandatProposeLe?.toISOString(),
          estimationProposeeLe: dossier.estimationProposeeLe ?? undefined,
          rdvEstimationRealiseLe: dossier.rdvEstimationRealiseLe?.toISOString(),
          qualifieLe: dossier.qualifieLe?.toISOString(),
        }),
        localisation: localisationProspect(dossier),
        archiveLe: dossier.archiveLe?.toISOString(),
      });
    }
  }

  const roles: RoleContact[] = [];
  if (projetsAcquereur.size > 0) roles.push("acquereur");
  if (projetsVendeur.size > 0) roles.push("vendeur");

  return {
    type: "actif",
    detail: {
    contact: identite,
    roles,
    projetsAcquereur: [...projetsAcquereur.values()],
    projetsVendeur: [...projetsVendeur.values()],
    dossiersAcquereurContactOnly,
    dossiersVendeurContactOnly,
    interactionsRecentes: interactions.map((ligne) => ({
      id: ligne.id,
      type: ligne.type as TypeInteraction,
      sens: (ligne.sens as SensInteraction | null) ?? undefined,
      survenuLe: ligne.survenuLe.toISOString(),
      contexte: contexteInteraction(ligne),
    })),
    fusionsAbsorbees,
    },
  };
}
