import { and, eq, type SQL } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  biens as biensTable,
  champsVerrouilles as champsVerrouillesTable,
  contacts as contactsTable,
  mandats as mandatsTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
} from "@/db/schema";
import type { ChampVerrouille, CibleVerrouillable } from "@/types/provenance";

// ADR-056 §4, invariant 4 — le verrou humain. Une valeur qu'un humain a corrigée n'est jamais
// réécrite par une synchronisation, et seul un geste humain explicite lève le verrou.

type LigneVerrou = typeof champsVerrouillesTable.$inferSelect;

// Champs verrouillables PAR TYPE D'ENTITÉ. La validation vit ici, et non en base, parce que c'est
// ici que le type de l'entité est connu : un `CHECK` global devrait énumérer les champs de toutes
// les entités à la fois, et deviendrait un catalogue de colonnes à maintenir à chaque migration.
//
// Ce sont des noms de propriétés CANONIQUES DOMIORA, jamais des chemins fournisseur : le verrou
// protège le Core, pas une correspondance. Volontairement limité aux champs qu'une source externe
// pourrait réellement proposer — pas à toutes les colonnes.
const CHAMPS_VERROUILLABLES: Record<CibleVerrouillable["type"], readonly string[]> = {
  contact: ["nom", "prenom", "email", "telephone"],
  projet_acquereur: [
    "budgetMin",
    "budgetMax",
    "criteres",
    "stadeProjet",
    "piecesMin",
    "surfaceMin",
    "accessibiliteRequise",
    "necessiteParking",
    "necessiteExterieur",
  ],
  projet_vendeur: ["origineLead", "origineLeadDetail", "estimationProposeeCentimes", "estimationProposeeLe"],
  bien: ["titre", "type", "adresse", "ville", "codePostal", "surface", "pieces", "prix", "description"],
  mandat: ["dateDebut", "dateFin"],
};

export function estChampVerrouillable(typeEntite: CibleVerrouillable["type"], champ: string): boolean {
  return CHAMPS_VERROUILLABLES[typeEntite].includes(champ);
}

function ligneVersCible(ligne: LigneVerrou): CibleVerrouillable {
  if (ligne.contactId) return { type: "contact", id: ligne.contactId };
  if (ligne.projetAcquereurId) return { type: "projet_acquereur", id: ligne.projetAcquereurId };
  if (ligne.projetVendeurId) return { type: "projet_vendeur", id: ligne.projetVendeurId };
  if (ligne.bienId) return { type: "bien", id: ligne.bienId };
  if (ligne.mandatId) return { type: "mandat", id: ligne.mandatId };
  throw new Error(`Champ verrouillé sans cible canonique : ${ligne.id}`);
}

function ligneVersVerrou(ligne: LigneVerrou): ChampVerrouille {
  return {
    id: ligne.id,
    cible: ligneVersCible(ligne),
    champ: ligne.champ,
    verrouilleLe: ligne.verrouilleLe.toISOString(),
  };
}

function colonnesCible(cible: CibleVerrouillable) {
  return {
    contactId: cible.type === "contact" ? cible.id : null,
    projetAcquereurId: cible.type === "projet_acquereur" ? cible.id : null,
    projetVendeurId: cible.type === "projet_vendeur" ? cible.id : null,
    bienId: cible.type === "bien" ? cible.id : null,
    mandatId: cible.type === "mandat" ? cible.id : null,
  };
}

function filtreCible(cible: CibleVerrouillable): SQL | undefined {
  switch (cible.type) {
    case "contact":
      return eq(champsVerrouillesTable.contactId, cible.id);
    case "projet_acquereur":
      return eq(champsVerrouillesTable.projetAcquereurId, cible.id);
    case "projet_vendeur":
      return eq(champsVerrouillesTable.projetVendeurId, cible.id);
    case "bien":
      return eq(champsVerrouillesTable.bienId, cible.id);
    case "mandat":
      return eq(champsVerrouillesTable.mandatId, cible.id);
  }
}

async function workspaceDeLaCible(cible: CibleVerrouillable, executeur: Executeur): Promise<string | undefined> {
  switch (cible.type) {
    case "contact": {
      const [l] = await executeur
        .select({ workspaceId: contactsTable.workspaceId })
        .from(contactsTable)
        .where(eq(contactsTable.id, cible.id))
        .limit(1);
      return l?.workspaceId;
    }
    case "projet_acquereur": {
      const [l] = await executeur
        .select({ workspaceId: projetsAcquereurTable.workspaceId })
        .from(projetsAcquereurTable)
        .where(eq(projetsAcquereurTable.id, cible.id))
        .limit(1);
      return l?.workspaceId;
    }
    case "projet_vendeur": {
      const [l] = await executeur
        .select({ workspaceId: projetsVendeurTable.workspaceId })
        .from(projetsVendeurTable)
        .where(eq(projetsVendeurTable.id, cible.id))
        .limit(1);
      return l?.workspaceId;
    }
    case "bien": {
      const [l] = await executeur
        .select({ workspaceId: biensTable.workspaceId })
        .from(biensTable)
        .where(eq(biensTable.id, cible.id))
        .limit(1);
      return l?.workspaceId;
    }
    case "mandat": {
      const [l] = await executeur
        .select({ workspaceId: biensTable.workspaceId })
        .from(mandatsTable)
        .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
        .where(eq(mandatsTable.id, cible.id))
        .limit(1);
      return l?.workspaceId;
    }
  }
}

// IDEMPOTENT : verrouiller deux fois le même champ est le même fait, pas deux. La date du PREMIER
// verrou est conservée — c'est elle qui dit depuis quand la valeur est protégée, et la réécrire à
// chaque appel effacerait cette information.
export async function verrouillerChamp(
  cible: CibleVerrouillable,
  champ: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ChampVerrouille> {
  if (!estChampVerrouillable(cible.type, champ)) {
    throw new Error(`Champ non verrouillable pour ${cible.type} : ${champ}`);
  }

  const workspaceCible = await workspaceDeLaCible(cible, executeur);
  if (!workspaceCible) throw new Error(`Entité canonique introuvable : ${cible.type} ${cible.id}`);
  if (workspaceCible !== workspaceId) {
    throw new Error("Un verrou ne peut pas viser une entité d'un autre workspace");
  }

  const [existant] = await executeur
    .select()
    .from(champsVerrouillesTable)
    .where(and(filtreCible(cible), eq(champsVerrouillesTable.champ, champ)))
    .limit(1);
  if (existant) return ligneVersVerrou(existant);

  const [ligne] = await executeur
    .insert(champsVerrouillesTable)
    .values({ workspaceId, ...colonnesCible(cible), champ })
    .returning();
  return ligneVersVerrou(ligne);
}

// Le déverrouillage est un GESTE HUMAIN EXPLICITE (ADR-056 §5, « un override n'est jamais levé
// automatiquement »). Aucune synchronisation ne doit appeler cette fonction.
export async function deverrouillerChamp(
  cible: CibleVerrouillable,
  champ: string,
  executeur: Executeur = getDb()
): Promise<void> {
  await executeur
    .delete(champsVerrouillesTable)
    .where(and(filtreCible(cible), eq(champsVerrouillesTable.champ, champ)));
}

export async function listerChampsVerrouilles(cible: CibleVerrouillable): Promise<ChampVerrouille[]> {
  const lignes = await getDb().select().from(champsVerrouillesTable).where(filtreCible(cible));
  return lignes.map(ligneVersVerrou);
}

// La question que pose le moteur de synchronisation avant d'écrire un champ.
export async function champEstVerrouille(
  cible: CibleVerrouillable,
  champ: string,
  // `executeur` optionnel : le Sync Engine lit le verrou DANS sa transaction, jamais avant elle —
  // sinon il écrirait à partir d'un état de verrou périmé.
  executeur: Executeur = getDb()
): Promise<boolean> {
  const [ligne] = await executeur
    .select({ id: champsVerrouillesTable.id })
    .from(champsVerrouillesTable)
    .where(and(filtreCible(cible), eq(champsVerrouillesTable.champ, champ)))
    .limit(1);
  return ligne !== undefined;
}
