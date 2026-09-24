import { and, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import {
  evenementsMetier as evenementsMetierTable,
  executionsAutomatisation as executionsAutomatisationTable,
  interactions as interactionsTable,
} from "@/db/schema";
import type { Interaction, SensInteraction, TypeInteraction } from "@/types/interaction";
import { verrouillerVisite } from "@/lib/visiteRepository";
import { getCompteRenduVisiteParVisiteId } from "@/lib/compteRenduVisiteRepository";
import { mandatCourantDuBien } from "@/lib/mandatRepository";
import { listerPartiesMandat } from "@/lib/partieMandatRepository";
import { verrouillerContactActif } from "@/lib/contactActif";
import { terminerTache } from "@/lib/tacheRepository";

// SELLER_FEEDBACK_INTERACTION_V1 (ADR-063) — fait le "retour vendeur après visite" un fait CRM
// canonique (Interaction), jamais seulement une tâche cochée. La tâche `retour_vendeur_apres_visite`
// reste "travail à faire" ; l'Interaction devient la preuve/l'historique que le travail a été fait.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGLE_CODE_RETOUR_VENDEUR = "retour_vendeur_apres_visite" as const;

type LigneInteraction = typeof interactionsTable.$inferSelect;

function ligneVersInteraction(ligne: LigneInteraction): Interaction {
  return {
    id: ligne.id,
    contactId: ligne.contactId,
    type: ligne.type as TypeInteraction,
    sens: (ligne.sens as SensInteraction | null) ?? undefined,
    survenuLe: ligne.survenuLe.toISOString(),
    contenu: ligne.contenu ?? undefined,
    bienId: ligne.bienId ?? undefined,
    visiteId: ligne.visiteId ?? undefined,
    natureMetier: (ligne.natureMetier as "retour_vendeur_post_visite" | null) ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

export type VendeurCanonique = { contactId: string; nom: string; prenom?: string };

// Résolution CANONIQUE du/des vendeur(s) d'un Bien (brief §5/§6) — via le mandat COURANT (non
// résilié, non remplacé) et ses parties de rôle `mandant` UNIQUEMENT (le `representant`, quand il
// existe, n'est pas le destinataire personnel d'un retour vendeur — décision V1 explicite).
// Multi-mandants gérés nativement : autant de Contacts que de parties `mandant`, dédoublonnés par
// Contact final (`UNIQUE(mandat_id, contact_id)` empêche déjà un doublon au sein d'un même mandat,
// mais rien n'empêche structurellement deux LIGNES de pointer le même Contact avec des rôles
// différents — dédoublonné par prudence).
//
// AUCUN repli vers `prospects_vendeurs` (le modèle legacy utilisé par la RÈGLE DE TÂCHE existante,
// `retour_vendeur_apres_visite`) : le type `ProspectVendeur` retourné par
// `getProspectVendeurParBien` n'expose délibérément PAS de `contactId` à la lecture (seul le type
// d'ÉCRITURE `NouveauProspectVendeur` le porte, confirmé par audit) — ce repository-ci n'écrit que
// vers des Contacts canoniques (`interactions.contact_id NOT NULL`) et refuse d'inventer un pont
// que la couche de lecture elle-même ne surface pas. Un bien dont le mandat courant n'a encore
// AUCUNE partie `mandant` renseignée (cas réel : `parties_mandat` est un modèle plus récent que
// `prospects_vendeurs`, non backfillé) renvoie donc une liste VIDE — jamais une erreur, jamais un
// destinataire deviné — documenté comme limitation V1 (`KNOWN_LIMITATIONS.md`).
export async function vendeursCanoniquesDuBien(
  bienId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<VendeurCanonique[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const mandat = await mandatCourantDuBien(bienId, workspaceId, undefined, executeur);
  if (!mandat) return [];
  const parties = await listerPartiesMandat(mandat.id, workspaceId, executeur);
  const parContact = new Map<string, VendeurCanonique>();
  for (const partie of parties) {
    if (partie.role !== "mandant") continue;
    if (!parContact.has(partie.contact.id)) {
      parContact.set(partie.contact.id, { contactId: partie.contact.id, nom: partie.contact.nom, prenom: partie.contact.prenom });
    }
  }
  return [...parContact.values()];
}

// Retrouve la tâche `retour_vendeur_apres_visite` ENCORE OUVERTE pour cette Visite, si elle existe
// — jointure tâche -> exécution -> événement (même patron que
// `scanners/mandatExpireBientot.ts:idsTachesObsoletes`), jamais une seconde colonne de rattachement
// direct. `visite_realisee` cible `compteRenduVisiteId`, contrat inchangé (ADR-041 §5) : la tâche
// se retrouve donc EN PASSANT PAR le compte rendu, jamais par un id de Visite qu'elle ne porte pas.
async function tacheRetourVendeurOuvertePourVisite(
  visiteId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<string | undefined> {
  const compteRendu = await getCompteRenduVisiteParVisiteId(visiteId, workspaceId, executeur);
  if (!compteRendu) return undefined;
  const [ligne] = await executeur
    .select({ tacheId: executionsAutomatisationTable.tacheId })
    .from(executionsAutomatisationTable)
    .innerJoin(evenementsMetierTable, eq(evenementsMetierTable.id, executionsAutomatisationTable.evenementId))
    .where(
      and(
        eq(executionsAutomatisationTable.regleCode, REGLE_CODE_RETOUR_VENDEUR),
        eq(evenementsMetierTable.compteRenduVisiteId, compteRendu.id),
        eq(evenementsMetierTable.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return ligne?.tacheId ?? undefined;
}

export type NouveauRetourVendeurVisite = {
  visiteId: string;
  canal: TypeInteraction;
  note?: string;
};

export type ResultatRetourVendeurVisite =
  | { statut: "enregistre"; interactions: Interaction[]; tacheClotureeId?: string }
  | { statut: "deja_enregistre" }
  | { statut: "introuvable" }
  | { statut: "visite_non_realisee" }
  | { statut: "aucun_vendeur_canonique" }
  | { statut: "contact_fusionne" };

// Writer central (brief §7) : verrouille la Visite, vérifie realisee (CR garanti par invariant
// structurel, §22 — jamais une seconde source de vérité), résout les vendeurs canoniques, crée une
// Interaction PAR vendeur (protégée contre le double submit par l'index unique partiel dédié,
// §9/§36), clôture la tâche retour_vendeur_apres_visite si encore ouverte — le tout dans UNE seule
// transaction (§8 : jamais une Interaction créée sans clôture, ni l'inverse).
export async function enregistrerRetourVendeurVisite(
  input: NouveauRetourVendeurVisite,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatRetourVendeurVisite> {
  return executeur.transaction(async (tx) => {
    const verrou = await verrouillerVisite(input.visiteId, workspaceId, tx);
    if (verrou.statut !== "verrouille") return { statut: "introuvable" };
    if (verrou.ligne.statut !== "realisee") return { statut: "visite_non_realisee" };

    const vendeurs = await vendeursCanoniquesDuBien(verrou.ligne.bienId, workspaceId, tx);
    if (vendeurs.length === 0) return { statut: "aucun_vendeur_canonique" };

    const survenuLe = new Date();
    const interactionsCreees: Interaction[] = [];

    for (const vendeur of vendeurs) {
      // ADR-059 §10 — lu SOUS VERROU, DANS cette transaction : un contact absorbé refuse
      // l'écriture, jamais une Interaction vers un Contact figé.
      const etatContact = await verrouillerContactActif(vendeur.contactId, tx, workspaceId);
      if (etatContact.statut === "fusionne") return { statut: "contact_fusionne" };
      if (etatContact.statut === "introuvable") continue; // course rare, contact disparu entre-temps

      const [ligne] = await tx
        .insert(interactionsTable)
        .values({
          contactId: vendeur.contactId,
          type: input.canal,
          sens: "sortant",
          survenuLe,
          contenu: input.note ?? null,
          visiteId: input.visiteId,
          natureMetier: "retour_vendeur_post_visite",
        })
        // Cible l'index unique partiel dédié (§9/§36) — un double submit pour LE MÊME
        // (visite, contact) ne crée jamais une deuxième ligne "officielle" ; un `where` identique
        // au prédicat de l'index, exigé par l'arbitre ON CONFLICT de Postgres.
        .onConflictDoNothing({
          target: [interactionsTable.visiteId, interactionsTable.contactId],
          where: eq(interactionsTable.natureMetier, "retour_vendeur_post_visite"),
        })
        .returning();
      if (ligne) interactionsCreees.push(ligneVersInteraction(ligne));
    }

    if (interactionsCreees.length === 0) return { statut: "deja_enregistre" };

    const tacheId = await tacheRetourVendeurOuvertePourVisite(input.visiteId, workspaceId, tx);
    let tacheClotureeId: string | undefined;
    if (tacheId) {
      const tache = await terminerTache(tacheId, workspaceId, tx);
      if (tache) tacheClotureeId = tache.id;
    }

    return { statut: "enregistre", interactions: interactionsCreees, tacheClotureeId };
  });
}
