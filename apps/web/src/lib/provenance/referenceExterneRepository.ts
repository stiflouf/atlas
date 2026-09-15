import { and, eq, type SQL } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { ErreurContactFusionne, verrouillerContactActif } from "@/lib/contactActif";
import {
  biens as biensTable,
  contacts as contactsTable,
  interactions as interactionsTable,
  mandats as mandatsTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
  referencesExternes as referencesExternesTable,
} from "@/db/schema";
import type { CibleCanonique, ReferenceExterne } from "@/types/provenance";

// ADR-056 §2/§3 — la résolution d'identité externe. C'est la couche SYNC ENGINE : elle connaît les
// fournisseurs et le Core, jamais l'inverse.
//
// Ce module RÉSOUT une identité ; il ne DÉDUPLIQUE jamais (ADR-056 §3, ADR-055 §H). Rattacher deux
// références au même contact est une assertion portée par l'appelant — aucune règle ici ne déduit
// « même email donc même personne ».

type LigneReference = typeof referencesExternesTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Une ligne porte exactement une cible (CHECK en base) : la reconstruire ne peut pas échouer, mais
// on ne suppose pas — une ligne écrite hors du repository doit produire une erreur, pas un objet
// à moitié faux.
function ligneVersCible(ligne: LigneReference): CibleCanonique {
  if (ligne.contactId) return { type: "contact", id: ligne.contactId };
  if (ligne.projetAcquereurId) return { type: "projet_acquereur", id: ligne.projetAcquereurId };
  if (ligne.projetVendeurId) return { type: "projet_vendeur", id: ligne.projetVendeurId };
  if (ligne.bienId) return { type: "bien", id: ligne.bienId };
  if (ligne.mandatId) return { type: "mandat", id: ligne.mandatId };
  if (ligne.interactionId) return { type: "interaction", id: ligne.interactionId };
  throw new Error(`Référence externe sans cible canonique : ${ligne.id}`);
}

function ligneVersReference(ligne: LigneReference): ReferenceExterne {
  return {
    id: ligne.id,
    fournisseur: ligne.fournisseur,
    typeEntiteExterne: ligne.typeEntiteExterne,
    idExterne: ligne.idExterne,
    cible: ligneVersCible(ligne),
    vuePourLaPremiereFoisLe: ligne.vuePourLaPremiereFoisLe.toISOString(),
    vuePourLaDerniereFoisLe: ligne.vuePourLaDerniereFoisLe.toISOString(),
  };
}

// Colonnes de cible : une seule est renseignée, les cinq autres sont explicitement nulles.
function colonnesCible(cible: CibleCanonique) {
  return {
    contactId: cible.type === "contact" ? cible.id : null,
    projetAcquereurId: cible.type === "projet_acquereur" ? cible.id : null,
    projetVendeurId: cible.type === "projet_vendeur" ? cible.id : null,
    bienId: cible.type === "bien" ? cible.id : null,
    mandatId: cible.type === "mandat" ? cible.id : null,
    interactionId: cible.type === "interaction" ? cible.id : null,
  };
}

function filtreCible(cible: CibleCanonique): SQL | undefined {
  switch (cible.type) {
    case "contact":
      return eq(referencesExternesTable.contactId, cible.id);
    case "projet_acquereur":
      return eq(referencesExternesTable.projetAcquereurId, cible.id);
    case "projet_vendeur":
      return eq(referencesExternesTable.projetVendeurId, cible.id);
    case "bien":
      return eq(referencesExternesTable.bienId, cible.id);
    case "mandat":
      return eq(referencesExternesTable.mandatId, cible.id);
    case "interaction":
      return eq(referencesExternesTable.interactionId, cible.id);
  }
}

// Lit le périmètre de l'entité canonique visée. `interactions` est une feuille de `contacts` et
// `mandats` une feuille de `biens` : leur workspace se lit par jointure, jamais par une colonne
// dupliquée (ADR-054 §7).
async function workspaceDeLaCible(cible: CibleCanonique, executeur: Executeur): Promise<string | undefined> {
  switch (cible.type) {
    case "contact": {
      const [ligne] = await executeur
        .select({ workspaceId: contactsTable.workspaceId })
        .from(contactsTable)
        .where(eq(contactsTable.id, cible.id))
        .limit(1);
      return ligne?.workspaceId;
    }
    case "projet_acquereur": {
      const [ligne] = await executeur
        .select({ workspaceId: projetsAcquereurTable.workspaceId })
        .from(projetsAcquereurTable)
        .where(eq(projetsAcquereurTable.id, cible.id))
        .limit(1);
      return ligne?.workspaceId;
    }
    case "projet_vendeur": {
      const [ligne] = await executeur
        .select({ workspaceId: projetsVendeurTable.workspaceId })
        .from(projetsVendeurTable)
        .where(eq(projetsVendeurTable.id, cible.id))
        .limit(1);
      return ligne?.workspaceId;
    }
    case "bien": {
      const [ligne] = await executeur
        .select({ workspaceId: biensTable.workspaceId })
        .from(biensTable)
        .where(eq(biensTable.id, cible.id))
        .limit(1);
      return ligne?.workspaceId;
    }
    case "mandat": {
      const [ligne] = await executeur
        .select({ workspaceId: biensTable.workspaceId })
        .from(mandatsTable)
        .innerJoin(biensTable, eq(mandatsTable.bienId, biensTable.id))
        .where(eq(mandatsTable.id, cible.id))
        .limit(1);
      return ligne?.workspaceId;
    }
    case "interaction": {
      const [ligne] = await executeur
        .select({ workspaceId: contactsTable.workspaceId })
        .from(interactionsTable)
        .innerJoin(contactsTable, eq(interactionsTable.contactId, contactsTable.id))
        .where(eq(interactionsTable.id, cible.id))
        .limit(1);
      return ligne?.workspaceId;
    }
  }
}

export type IdentiteExterne = {
  fournisseur: string;
  typeEntiteExterne: string;
  idExterne: string;
};

export type NouvelleReferenceExterne = IdentiteExterne & { cible: CibleCanonique };

// ADR-054 — `references_externes` est une RACINE : `workspaceId` est un paramètre obligatoire, il
// vient du contexte authentifié. Il doit néanmoins coïncider avec le périmètre de l'entité visée :
// la base ne peut pas le vérifier (la cible ne porte pas toujours son workspace en colonne), donc
// ce chemin le fait et échoue bruyamment. Même garde que `ajouterPartieProjet`, `creerMandat` et
// `creerInteraction`.
//
// Revoir une identité déjà connue n'est PAS une erreur : c'est le cas normal de chaque pull. La
// référence est alors simplement redatée, et l'appel est idempotent. En revanche, la même identité
// pointant vers une AUTRE entité est refusée par le `UNIQUE` — c'est l'invariant 2, tenu par la
// base et non par une discipline applicative.
export async function enregistrerReferenceExterne(
  input: NouvelleReferenceExterne,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ReferenceExterne> {
  return executeur.transaction(async (tx) => {
  // ADR-059 §10 — une identité externe ne se rattache plus à un contact absorbé : la cible contact
  // est lue SOUS VERROU (les autres cibles ne portent pas cet état). Jamais réécrit vers le survivant.
  if (input.cible.type === "contact") {
    const etat = await verrouillerContactActif(input.cible.id, tx);
    if (etat.statut === "introuvable") throw new Error(`Entité canonique introuvable : contact ${input.cible.id}`);
    if (etat.statut === "fusionne") throw new ErreurContactFusionne(input.cible.id);
    if (etat.workspaceId !== workspaceId) {
      throw new Error("Une référence externe ne peut pas viser une entité d'un autre workspace");
    }
  } else {
    const workspaceCible = await workspaceDeLaCible(input.cible, tx);
    if (!workspaceCible) throw new Error(`Entité canonique introuvable : ${input.cible.type} ${input.cible.id}`);
    if (workspaceCible !== workspaceId) {
      throw new Error("Une référence externe ne peut pas viser une entité d'un autre workspace");
    }
  }

  const [ligne] = await tx
    .insert(referencesExternesTable)
    .values({
      workspaceId,
      fournisseur: input.fournisseur,
      typeEntiteExterne: input.typeEntiteExterne,
      idExterne: input.idExterne,
      ...colonnesCible(input.cible),
      vuePourLaDerniereFoisLe: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        referencesExternesTable.workspaceId,
        referencesExternesTable.fournisseur,
        referencesExternesTable.typeEntiteExterne,
        referencesExternesTable.idExterne,
      ],
      // La cible n'est JAMAIS réécrite ici : re-pointer une identité externe vers une autre entité
      // serait une décision, pas une mise à jour de routine. Seule la date de dernière vue bouge.
      set: { vuePourLaDerniereFoisLe: new Date() },
      where: filtreCible(input.cible),
    })
    .returning();

  if (!ligne) {
    // Le conflit existe mais la cible ne correspond pas : cette identité externe désigne déjà une
    // AUTRE entité canonique. Refus explicite plutôt qu'un silence (ADR-056 invariant 2).
    throw new Error(
      `Identité externe déjà rattachée à une autre entité canonique : ${input.fournisseur}/${input.typeEntiteExterne}/${input.idExterne}`
    );
  }
  return ligneVersReference(ligne);
  });
}

// La question que pose un connecteur à chaque pull : « cet objet, je le connais déjà ? »
export async function resoudreEntiteCanonique(
  identite: IdentiteExterne,
  workspaceId: string,
  // `executeur` optionnel : le Sync Engine résout l'identité DANS la transaction qui écrira, pour
  // ne pas décider à partir d'un état qu'il aurait lu avant.
  executeur: Executeur = getDb()
): Promise<CibleCanonique | undefined> {
  const [ligne] = await executeur
    .select()
    .from(referencesExternesTable)
    .where(
      and(
        eq(referencesExternesTable.workspaceId, workspaceId),
        eq(referencesExternesTable.fournisseur, identite.fournisseur),
        eq(referencesExternesTable.typeEntiteExterne, identite.typeEntiteExterne),
        eq(referencesExternesTable.idExterne, identite.idExterne)
      )
    )
    .limit(1);
  return ligne ? ligneVersCible(ligne) : undefined;
}

// La question inverse : « sous quelles identités cette entité est-elle connue ailleurs ? »
export async function listerReferencesDeLEntite(cible: CibleCanonique): Promise<ReferenceExterne[]> {
  if (!UUID_REGEX.test(cible.id)) return [];
  const lignes = await getDb().select().from(referencesExternesTable).where(filtreCible(cible));
  return lignes.map(ligneVersReference);
}
