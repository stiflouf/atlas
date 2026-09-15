import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  champsVerrouilles as champsVerrouillesTable,
  contacts as contactsTable,
  interactions as interactionsTable,
  partiesProjet as partiesProjetTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
  prospectsVendeurs as prospectsVendeursTable,
  referencesExternes as referencesExternesTable,
} from "@/db/schema";
import { estContactFusionne } from "@/lib/contactFusion";
import { avertissementsReferencesExternes } from "@/lib/fusionContactAnalyse";
import { CHAMPS_IDENTITE_CONTACT, type ChampIdentiteContact } from "@/types/contactFusion";
import type { Contact } from "@/types/contact";
import type { CoteFusion, ImpactFusion, PreparationFusionContacts, ResolutionChampFusion } from "@/types/preparationFusion";
import type { RoleContact } from "@/types/rechercheContact";

// ADR-059 — PRÉPARER une fusion : tout ce que l'écran de comparaison affiche, en lecture, en un
// nombre fixe de requêtes. Ce module ne décide rien et n'écrit rien ; il montre les deux Contacts
// tels qu'ils sont, les champs à trancher, l'impact, et les avertissements — calculés par la MÊME
// analyse que le moteur (fusionContactAnalyse.ts), qui les recalculera sous verrou.
//
// La similarité n'est PAS une garde : deux Contacts sans email ni téléphone commun peuvent être la
// même personne (coordonnées changées). L'aide à la découverte et l'autorisation de fusionner sont
// deux choses ; seule la seconde est humaine.
//
// Périmètre : les deux Contacts dans le workspace, sinon introuvable — sans dire lequel existe
// ailleurs. Un Contact déjà absorbé n'est plus une partie à une fusion.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneContact = typeof contactsTable.$inferSelect;

function versContact(ligne: LigneContact): Contact {
  return {
    id: ligne.id,
    nom: ligne.nom,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
    fusionneDansContactId: ligne.fusionneDansContactId ?? undefined,
    fusionneLe: ligne.fusionneLe?.toISOString(),
  };
}

function resolutionChamp(champ: ChampIdentiteContact, survivant: Contact, absorbe: Contact): ResolutionChampFusion {
  const valeurSurvivant = survivant[champ] ?? undefined;
  const valeurAbsorbe = absorbe[champ] ?? undefined;
  const nature =
    valeurSurvivant === valeurAbsorbe
      ? "identique"
      : valeurSurvivant === undefined || valeurAbsorbe === undefined
        ? "absence_comblee"
        : "conflit";
  return { champ, valeurSurvivant, valeurAbsorbe, nature };
}

export async function preparerFusionContacts(
  params: { workspaceId: string; contactSurvivantId: string; contactAbsorbeId: string },
  executeur: Executeur = getDb()
): Promise<PreparationFusionContacts> {
  const { workspaceId, contactSurvivantId, contactAbsorbeId } = params;
  if (contactSurvivantId === contactAbsorbeId) return { statut: "meme_contact" };
  if (!UUID_REGEX.test(contactSurvivantId) || !UUID_REGEX.test(contactAbsorbeId)) {
    return { statut: "contact_introuvable" };
  }

  // REQUÊTE 1 — les deux contacts, dans le périmètre.
  const lignes = await executeur
    .select()
    .from(contactsTable)
    .where(and(inArray(contactsTable.id, [contactSurvivantId, contactAbsorbeId]), eq(contactsTable.workspaceId, workspaceId)));
  const ligneSurvivant = lignes.find((l) => l.id === contactSurvivantId);
  const ligneAbsorbe = lignes.find((l) => l.id === contactAbsorbeId);
  if (!ligneSurvivant || !ligneAbsorbe) return { statut: "contact_introuvable" };
  const survivant = versContact(ligneSurvivant);
  const absorbe = versContact(ligneAbsorbe);
  if (estContactFusionne(survivant) || estContactFusionne(absorbe)) return { statut: "deja_fusionne" };

  const ids = [contactSurvivantId, contactAbsorbeId];
  // REQUÊTES 2 à 7 — participations (avec projets pour le rôle dérivé), verrous, références, et
  // trois comptes de ce qui sera déplacé. Fixe, quel que soit le volume.
  const [parties, verrous, refs, [interactions], [dossiersAcquereur], [dossiersVendeur]] = await Promise.all([
    executeur
      .select({
        contactId: partiesProjetTable.contactId,
        projetAcquereurId: partiesProjetTable.projetAcquereurId,
        projetVendeurId: partiesProjetTable.projetVendeurId,
        acquereurArchiveLe: projetsAcquereurTable.archiveLe,
        vendeurArchiveLe: projetsVendeurTable.archiveLe,
      })
      .from(partiesProjetTable)
      .leftJoin(projetsAcquereurTable, eq(partiesProjetTable.projetAcquereurId, projetsAcquereurTable.id))
      .leftJoin(projetsVendeurTable, eq(partiesProjetTable.projetVendeurId, projetsVendeurTable.id))
      .where(inArray(partiesProjetTable.contactId, ids))
      .orderBy(asc(partiesProjetTable.creeLe)),
    executeur
      .select({ contactId: champsVerrouillesTable.contactId, champ: champsVerrouillesTable.champ })
      .from(champsVerrouillesTable)
      .where(inArray(champsVerrouillesTable.contactId, ids)),
    executeur
      .select({
        contactId: referencesExternesTable.contactId,
        fournisseur: referencesExternesTable.fournisseur,
        typeEntiteExterne: referencesExternesTable.typeEntiteExterne,
        idExterne: referencesExternesTable.idExterne,
      })
      .from(referencesExternesTable)
      .where(inArray(referencesExternesTable.contactId, ids)),
    executeur
      .select({ n: sql<number>`count(*)::int` })
      .from(interactionsTable)
      .where(eq(interactionsTable.contactId, contactAbsorbeId)),
    executeur
      .select({ n: sql<number>`count(*)::int` })
      .from(acquereursTable)
      .where(and(eq(acquereursTable.contactId, contactAbsorbeId), eq(acquereursTable.workspaceId, workspaceId))),
    executeur
      .select({ n: sql<number>`count(*)::int` })
      .from(prospectsVendeursTable)
      .where(and(eq(prospectsVendeursTable.contactId, contactAbsorbeId), eq(prospectsVendeursTable.workspaceId, workspaceId))),
  ]);

  // Rôles et projets par Contact — même sémantique que la recherche et la fiche : projets non
  // archivés. Les projets sont comptés par id, jamais deux fois.
  const projetsPar = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const rolesPar = new Map<string, Set<RoleContact>>(ids.map((id) => [id, new Set<RoleContact>()]));
  for (const partie of parties) {
    if (partie.projetAcquereurId && !partie.acquereurArchiveLe) {
      projetsPar.get(partie.contactId)!.add(`acquereur:${partie.projetAcquereurId}`);
      rolesPar.get(partie.contactId)!.add("acquereur");
    }
    if (partie.projetVendeurId && !partie.vendeurArchiveLe) {
      projetsPar.get(partie.contactId)!.add(`vendeur:${partie.projetVendeurId}`);
      rolesPar.get(partie.contactId)!.add("vendeur");
    }
  }
  const projetsSurvivant = projetsPar.get(contactSurvivantId)!;
  const projetsAbsorbe = projetsPar.get(contactAbsorbeId)!;
  const projetsCommuns = [...projetsAbsorbe].filter((p) => projetsSurvivant.has(p)).length;

  const cote = (contact: Contact): CoteFusion => ({
    contact,
    identiteAttendue: {
      nom: contact.nom,
      prenom: contact.prenom,
      email: contact.email,
      telephone: contact.telephone,
      modifieLe: contact.modifieLe,
    },
    roles: (["acquereur", "vendeur"] as const).filter((r) => rolesPar.get(contact.id)!.has(r)),
    nbProjets: projetsPar.get(contact.id)!.size,
    champsModifiesManuellement: CHAMPS_IDENTITE_CONTACT.filter((champ) =>
      verrous.some((v) => v.contactId === contact.id && v.champ === champ)
    ),
  });

  const impact: ImpactFusion = {
    projetsConcernes: new Set([...projetsSurvivant, ...projetsAbsorbe]).size,
    projetsCommuns,
    interactionsDeplacees: interactions.n,
    dossiersAcquereurDeplaces: dossiersAcquereur.n,
    dossiersVendeurDeplaces: dossiersVendeur.n,
    identifiantsExternesDeplaces: refs.filter((r) => r.contactId === contactAbsorbeId).length,
  };
  return {
    statut: "pret",
    survivant: cote(survivant),
    absorbe: cote(absorbe),
    champs: CHAMPS_IDENTITE_CONTACT.map((champ) => resolutionChamp(champ, survivant, absorbe)),
    impact,
    avertissements: avertissementsReferencesExternes(refs, contactSurvivantId, contactAbsorbeId),
  };
}
