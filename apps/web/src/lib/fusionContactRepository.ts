import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  acquereurs as acquereursTable,
  contactFusions as contactFusionsTable,
  contacts as contactsTable,
  interactions as interactionsTable,
  partiesMandat as partiesMandatTable,
  partiesProjet as partiesProjetTable,
  prospectsVendeurs as prospectsVendeursTable,
  referencesExternes as referencesExternesTable,
} from "@/db/schema";
import { marquerContactFusionne, modifierIdentiteContact } from "@/lib/contactRepository";
import { avertissementsReferencesExternes } from "@/lib/fusionContactAnalyse";
import {
  CHAMPS_IDENTITE_CONTACT,
  type ActeurFusion,
  type AvertissementFusionContact,
  type ChampIdentiteContact,
  type ChoixFusionChamp,
  type ChoixFusionParChamp,
  type IdentiteContactAttendue,
  type IdentiteContactSnapshot,
  type IdsDeplacesFusionContact,
} from "@/types/contactFusion";
import type { RolePartieProjet } from "@/types/partieProjet";
import { roleRetenuPartieMandat, type RolePartieMandat } from "@/types/partieMandat";

// ADR-059 — LE MOTEUR de fusion : absorbé → survivant, en UNE transaction, ou rien. Il ne décide
// rien : l'identité finale et le choix champ par champ lui sont donnés par un humain, et il
// vérifie qu'ils se correspondent avant d'écrire quoi que ce soit. Il ne fait confiance à aucune
// UI : même workspace, ids distincts, contacts actifs, identités inchangées depuis leur affichage,
// avertissements acquittés — tout est revérifié SOUS VERROU.
//
// Ordre, et il est impératif :
//   1. FOR UPDATE sur les deux contacts, par id croissant (jamais par rôle : l'ordre de verrou ne
//      dit rien de la direction de fusion, il évite seulement l'interblocage de deux fusions
//      croisées) ;
//   2. invariants et concurrence ;
//   3. parties de projet : supprimer celles de l'absorbé sur les projets COMMUNS avant tout
//      repoint — sinon UNIQUE(projet, contact) ; parties de mandat (ADR-060 §16) : même
//      dédoublonnage sur les mandats COMMUNS, rôle retenu déterministe (mandant > representant) ;
//   4. repoint des dépendances (parties restantes, interactions, dossiers historiques, références
//      externes) — jamais un instantané d'identité legacy, jamais un verrou ;
//   5. identité finale du survivant par le writer unique `modifierIdentiteContact` (no-op si
//      identique : aucun verrou inutile) ;
//   6. marqueur sur l'absorbé (`marquerContactFusionne`) ;
//   7. journal `contact_fusions`, avec les ids exacts déplacés.
//
// Aucune écriture hors transaction ; aucune session ; aucune UI. Les verrous humains de l'absorbé
// restent sur sa ligne (audit, et UNIQUE(contact, champ)) : ceux du survivant sont décidés par
// l'identité finale, via le writer.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHOIX_VALIDES: readonly ChoixFusionChamp[] = ["survivant", "absorbe", "identique", "absence_comblee"];

// Rôle PRINCIPAL par type de projet : sur un projet commun, la participation conservée porte le
// rôle le plus fort des deux.
const ROLE_PRINCIPAL: Record<"acquereur" | "vendeur", RolePartieProjet> = { acquereur: "acquereur", vendeur: "vendeur" };

export type ParametresFusionContacts = {
  workspaceId: string;
  contactSurvivantId: string;
  contactAbsorbeId: string;
  // Ce que l'humain a vu, pour chacun des deux : recomparé sous verrou.
  identiteAttendueSurvivant: IdentiteContactAttendue;
  identiteAttendueAbsorbe: IdentiteContactAttendue;
  identiteFinale: IdentiteContactSnapshot;
  choixParChamp: ChoixFusionParChamp;
  acteur: ActeurFusion;
  avertissementsAcquittes?: string[];
};

export type ResultatFusionContacts =
  | { statut: "fusionne"; fusionId: string; contactSurvivantId: string; idsDeplaces: IdsDeplacesFusionContact }
  | { statut: "meme_contact" }
  | { statut: "contact_introuvable" }
  | { statut: "deja_fusionne" }
  | { statut: "identite_modifiee_entre_temps" }
  | { statut: "choix_identite_invalide"; champ: ChampIdentiteContact }
  | { statut: "avertissement_reference_externe_requis"; avertissements: AvertissementFusionContact[] }
  | { statut: "acquittement_inconnu"; cles: string[] };

type LigneContact = typeof contactsTable.$inferSelect;

function identiteDe(ligne: LigneContact): IdentiteContactSnapshot {
  return {
    nom: ligne.nom,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
  };
}

function memeIdentite(a: IdentiteContactSnapshot, b: IdentiteContactSnapshot): boolean {
  return CHAMPS_IDENTITE_CONTACT.every((champ) => (a[champ] ?? undefined) === (b[champ] ?? undefined));
}

function identiteInchangee(ligne: LigneContact, attendue: IdentiteContactAttendue): boolean {
  return memeIdentite(identiteDe(ligne), attendue) && ligne.modifieLe.toISOString() === attendue.modifieLe;
}

// Le journal ne doit jamais raconter autre chose que ce qui a été appliqué : chaque choix est
// confronté aux deux identités réelles et à la valeur finale. `undefined` = absence, jamais "".
function champInvalide(
  survivant: IdentiteContactSnapshot,
  absorbe: IdentiteContactSnapshot,
  finale: IdentiteContactSnapshot,
  choix: ChoixFusionParChamp
): ChampIdentiteContact | undefined {
  for (const champ of CHAMPS_IDENTITE_CONTACT) {
    const valeurSurvivant = survivant[champ] ?? undefined;
    const valeurAbsorbe = absorbe[champ] ?? undefined;
    const valeurFinale = finale[champ] ?? undefined;
    const decision = choix[champ];
    if (!CHOIX_VALIDES.includes(decision)) return champ;
    if (champ === "nom" && (valeurFinale === undefined || valeurFinale.trim() === "")) return champ;

    const attendue = (() => {
      switch (decision) {
        case "survivant":
          return { ok: true, valeur: valeurSurvivant };
        case "absorbe":
          return { ok: true, valeur: valeurAbsorbe };
        case "identique":
          return { ok: valeurSurvivant === valeurAbsorbe, valeur: valeurSurvivant };
        case "absence_comblee":
          return {
            ok: (valeurSurvivant === undefined) !== (valeurAbsorbe === undefined),
            valeur: valeurSurvivant ?? valeurAbsorbe,
          };
      }
    })();
    if (!attendue.ok || attendue.valeur !== valeurFinale) return champ;
  }
  return undefined;
}

type LignePartie = typeof partiesProjetTable.$inferSelect;

function cleProjet(partie: LignePartie): { cle: string; type: "acquereur" | "vendeur" } {
  return partie.projetAcquereurId
    ? { cle: `acquereur:${partie.projetAcquereurId}`, type: "acquereur" }
    : { cle: `vendeur:${partie.projetVendeurId}`, type: "vendeur" };
}

export async function fusionnerContacts(
  params: ParametresFusionContacts,
  executeur: Executeur = getDb()
): Promise<ResultatFusionContacts> {
  const { workspaceId, contactSurvivantId, contactAbsorbeId } = params;
  // Avant toute transaction : un contact ne se fusionne pas avec lui-même, et un id mal formé
  // n'a rien à faire dans un cast Postgres.
  if (contactSurvivantId === contactAbsorbeId) return { statut: "meme_contact" };
  if (!UUID_REGEX.test(contactSurvivantId) || !UUID_REGEX.test(contactAbsorbeId)) {
    return { statut: "contact_introuvable" };
  }

  return executeur.transaction(async (tx) => {
    // 1. VERROUS — les deux lignes, par id croissant, en une seule instruction.
    const verrouillees = await tx
      .select()
      .from(contactsTable)
      .where(inArray(contactsTable.id, [contactSurvivantId, contactAbsorbeId]))
      .orderBy(asc(contactsTable.id))
      .for("update");
    const survivant = verrouillees.find((l) => l.id === contactSurvivantId);
    const absorbe = verrouillees.find((l) => l.id === contactAbsorbeId);

    // 2. INVARIANTS — hors périmètre = introuvable, sans dire lequel.
    if (!survivant || !absorbe || survivant.workspaceId !== workspaceId || absorbe.workspaceId !== workspaceId) {
      return { statut: "contact_introuvable" };
    }
    if (survivant.fusionneDansContactId !== null || absorbe.fusionneDansContactId !== null) {
      return { statut: "deja_fusionne" };
    }
    if (
      !identiteInchangee(survivant, params.identiteAttendueSurvivant) ||
      !identiteInchangee(absorbe, params.identiteAttendueAbsorbe)
    ) {
      return { statut: "identite_modifiee_entre_temps" };
    }
    const identiteAvantSurvivant = identiteDe(survivant);
    const identiteAvantAbsorbe = identiteDe(absorbe);
    const champ = champInvalide(identiteAvantSurvivant, identiteAvantAbsorbe, params.identiteFinale, params.choixParChamp);
    if (champ) return { statut: "choix_identite_invalide", champ };

    const refs = await tx
      .select({
        id: referencesExternesTable.id,
        contactId: referencesExternesTable.contactId,
        fournisseur: referencesExternesTable.fournisseur,
        typeEntiteExterne: referencesExternesTable.typeEntiteExterne,
        idExterne: referencesExternesTable.idExterne,
      })
      .from(referencesExternesTable)
      .where(inArray(referencesExternesTable.contactId, [contactSurvivantId, contactAbsorbeId]));
    const avertissements = avertissementsReferencesExternes(refs, contactSurvivantId, contactAbsorbeId);
    const acquittes = new Set(params.avertissementsAcquittes ?? []);
    const requis = new Set(avertissements.map((a) => a.cle));
    const inconnus = [...acquittes].filter((cle) => !requis.has(cle));
    if (inconnus.length > 0) return { statut: "acquittement_inconnu", cles: inconnus.sort() };
    if (avertissements.some((a) => !acquittes.has(a.cle))) {
      return { statut: "avertissement_reference_externe_requis", avertissements };
    }

    // 3. PARTIES DE PROJET — dédoubler les projets communs AVANT de repointer.
    const parties = await tx
      .select()
      .from(partiesProjetTable)
      .where(inArray(partiesProjetTable.contactId, [contactSurvivantId, contactAbsorbeId]))
      .orderBy(asc(partiesProjetTable.creeLe), asc(partiesProjetTable.id));
    const partiesSurvivant = new Map(parties.filter((p) => p.contactId === contactSurvivantId).map((p) => [cleProjet(p).cle, p]));
    const partiesProjetSupprimees: string[] = [];
    const partiesProjetRoleCorrige: IdsDeplacesFusionContact["partiesProjetRoleCorrige"] = [];
    for (const partieAbsorbe of parties.filter((p) => p.contactId === contactAbsorbeId)) {
      const { cle, type } = cleProjet(partieAbsorbe);
      const partieSurvivant = partiesSurvivant.get(cle);
      if (!partieSurvivant) continue;
      const principal = ROLE_PRINCIPAL[type];
      if (partieAbsorbe.role === principal && partieSurvivant.role !== principal) {
        await tx.update(partiesProjetTable).set({ role: principal }).where(eq(partiesProjetTable.id, partieSurvivant.id));
        partiesProjetRoleCorrige.push({ partieId: partieSurvivant.id, roleAvant: partieSurvivant.role, roleFinal: principal });
      }
      await tx.delete(partiesProjetTable).where(eq(partiesProjetTable.id, partieAbsorbe.id));
      partiesProjetSupprimees.push(partieAbsorbe.id);
    }

    // 3 bis. PARTIES DE MANDAT — même règle : dédoubler les mandats communs AVANT de repointer, sinon
    // UNIQUE(mandat, contact). Une seule ligne finale par mandat, portant le rôle le plus fort des
    // deux (`roleRetenuPartieMandat`, mandant > representant) : la ligne du survivant est conservée
    // et relevée si l'absorbé portait le rôle principal ; celle de l'absorbé est supprimée.
    const partiesMandatLues = await tx
      .select()
      .from(partiesMandatTable)
      .where(inArray(partiesMandatTable.contactId, [contactSurvivantId, contactAbsorbeId]))
      .orderBy(asc(partiesMandatTable.creeLe), asc(partiesMandatTable.id));
    const partiesMandatSurvivant = new Map(
      partiesMandatLues.filter((p) => p.contactId === contactSurvivantId).map((p) => [p.mandatId, p])
    );
    const partiesMandatSupprimees: string[] = [];
    const partiesMandatRoleCorrige: NonNullable<IdsDeplacesFusionContact["partiesMandatRoleCorrige"]> = [];
    for (const partieAbsorbe of partiesMandatLues.filter((p) => p.contactId === contactAbsorbeId)) {
      const partieSurvivant = partiesMandatSurvivant.get(partieAbsorbe.mandatId);
      if (!partieSurvivant) continue;
      const roleRetenu = roleRetenuPartieMandat(partieSurvivant.role as RolePartieMandat, partieAbsorbe.role as RolePartieMandat);
      if (roleRetenu !== partieSurvivant.role) {
        await tx.update(partiesMandatTable).set({ role: roleRetenu }).where(eq(partiesMandatTable.id, partieSurvivant.id));
        partiesMandatRoleCorrige.push({ partieId: partieSurvivant.id, roleAvant: partieSurvivant.role, roleFinal: roleRetenu });
      }
      await tx.delete(partiesMandatTable).where(eq(partiesMandatTable.id, partieAbsorbe.id));
      partiesMandatSupprimees.push(partieAbsorbe.id);
    }

    // 4. REPOINT — ids exacts, jamais un simple compte.
    const partiesProjet = (
      await tx
        .update(partiesProjetTable)
        .set({ contactId: contactSurvivantId })
        .where(eq(partiesProjetTable.contactId, contactAbsorbeId))
        .returning({ id: partiesProjetTable.id })
    ).map((l) => l.id);
    const partiesMandat = (
      await tx
        .update(partiesMandatTable)
        .set({ contactId: contactSurvivantId })
        .where(eq(partiesMandatTable.contactId, contactAbsorbeId))
        .returning({ id: partiesMandatTable.id })
    ).map((l) => l.id);
    const interactions = (
      await tx
        .update(interactionsTable)
        .set({ contactId: contactSurvivantId })
        .where(eq(interactionsTable.contactId, contactAbsorbeId))
        .returning({ id: interactionsTable.id })
    ).map((l) => l.id);
    const acquereurs = (
      await tx
        .update(acquereursTable)
        .set({ contactId: contactSurvivantId })
        .where(and(eq(acquereursTable.contactId, contactAbsorbeId), eq(acquereursTable.workspaceId, workspaceId)))
        .returning({ id: acquereursTable.id })
    ).map((l) => l.id);
    const prospectsVendeurs = (
      await tx
        .update(prospectsVendeursTable)
        .set({ contactId: contactSurvivantId })
        .where(and(eq(prospectsVendeursTable.contactId, contactAbsorbeId), eq(prospectsVendeursTable.workspaceId, workspaceId)))
        .returning({ id: prospectsVendeursTable.id })
    ).map((l) => l.id);
    const referencesExternes = (
      await tx
        .update(referencesExternesTable)
        .set({ contactId: contactSurvivantId })
        .where(eq(referencesExternesTable.contactId, contactAbsorbeId))
        .returning({ id: referencesExternesTable.id })
    ).map((l) => l.id);

    // 5. IDENTITÉ FINALE — par le writer unique, seulement si elle change (aucun verrou inutile).
    if (!memeIdentite(identiteAvantSurvivant, params.identiteFinale)) {
      const modifie = await modifierIdentiteContact(contactSurvivantId, params.identiteFinale, workspaceId, tx);
      if (!modifie) throw new Error("Le contact survivant a disparu pendant la fusion");
    }

    // 6. MARQUEUR — l'absorbé pointe le survivant.
    const marque = await marquerContactFusionne(contactAbsorbeId, contactSurvivantId, workspaceId, tx);
    if (!marque) throw new Error("Le contact absorbé a disparu pendant la fusion");

    // 7. JOURNAL.
    const idsDeplaces: IdsDeplacesFusionContact = {
      interactions,
      partiesProjet,
      partiesProjetSupprimees,
      partiesProjetRoleCorrige,
      partiesMandat,
      partiesMandatSupprimees,
      partiesMandatRoleCorrige,
      acquereurs,
      prospectsVendeurs,
      referencesExternes,
    };
    const [journal] = await tx
      .insert(contactFusionsTable)
      .values({
        contactSurvivantId,
        contactAbsorbeId,
        fusionneParSub: params.acteur.sub ?? null,
        fusionneParEmail: params.acteur.email ?? null,
        identiteAvantSurvivant,
        identiteAvantAbsorbe,
        identiteFinale: params.identiteFinale,
        choixParChamp: params.choixParChamp,
        idsDeplaces,
        avertissementsAcquittes: avertissements.map((a) => a.cle),
      })
      .returning({ id: contactFusionsTable.id });

    return { statut: "fusionne", fusionId: journal.id, contactSurvivantId, idsDeplaces };
  });
}
