import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { notesProspectVendeur as notesProspectVendeurTable, prospectsVendeurs as prospectsVendeursTable } from "@/db/schema";
import { TYPES_NOTE_INTERACTION } from "@/types/noteProspectVendeur";
import type { NoteProspectVendeur, TypeNoteProspectVendeur } from "@/types/noteProspectVendeur";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneNoteProspectVendeur = typeof notesProspectVendeurTable.$inferSelect;

function ligneVersNoteProspectVendeur(ligne: LigneNoteProspectVendeur): NoteProspectVendeur {
  return {
    id: ligne.id,
    prospectVendeurId: ligne.prospectVendeurId,
    type: ligne.type as TypeNoteProspectVendeur,
    contenu: ligne.contenu,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Pas de repli mock : une note n'existe que pour un prospect vendeur réel (FK uuid), même
// principe que noteBienRepository.listerNotesPourBien.
export async function listerNotesProspectVendeur(prospectVendeurId: string): Promise<NoteProspectVendeur[]> {
  if (!UUID_REGEX.test(prospectVendeurId)) return [];
  const lignes = await getDb()
    .select()
    .from(notesProspectVendeurTable)
    .where(eq(notesProspectVendeurTable.prospectVendeurId, prospectVendeurId))
    .orderBy(desc(notesProspectVendeurTable.creeLe));
  return lignes.map(ligneVersNoteProspectVendeur);
}

// ADR-027, correction n° 2 : une note n'est pas automatiquement une interaction. Seul un type
// membre de TYPES_NOTE_INTERACTION (jamais 'note_interne') met à jour dernier_contact_le — les
// deux écritures (note + éventuelle mise à jour du prospect) dans la même transaction, pour ne
// jamais laisser la note exister sans que dernier_contact_le reflète l'interaction qu'elle
// représente. Validation (contenu non vide après trim) déjà faite par l'appelant.
// WORKSPACE_SCOPING_V2A (ADR-054) — `notes_prospect_vendeur` est une FEUILLE de
// `prospects_vendeurs` : aucun `workspace_id` à filtrer sur l'INSERT. La preuve est prise sur la
// racine, sous verrou, dans la transaction qui porte DÉJÀ les deux écritures. Elle couvre donc
// aussi la seconde : avancer `dernier_contact_le` éteint les relances d'inactivité du dossier —
// un effet qu'un autre workspace ne doit jamais pouvoir déclencher, même sans lire la fiche.
export async function ajouterNoteProspectVendeur(
  prospectVendeurId: string,
  type: TypeNoteProspectVendeur,
  contenu: string,
  workspaceId: string
): Promise<NoteProspectVendeur | undefined> {
  if (!UUID_REGEX.test(prospectVendeurId)) return undefined;
  return getDb().transaction(async (tx) => {
    const [racine] = await tx
      .select({ id: prospectsVendeursTable.id })
      .from(prospectsVendeursTable)
      .where(and(eq(prospectsVendeursTable.id, prospectVendeurId), eq(prospectsVendeursTable.workspaceId, workspaceId)))
      .for("update");
    if (!racine) return undefined;

    const [ligne] = await tx
      .insert(notesProspectVendeurTable)
      .values({ prospectVendeurId, type, contenu })
      .returning();
    if (TYPES_NOTE_INTERACTION.includes(type)) {
      await tx
        .update(prospectsVendeursTable)
        .set({ dernierContactLe: new Date(), modifieLe: new Date() })
        .where(and(eq(prospectsVendeursTable.id, prospectVendeurId), eq(prospectsVendeursTable.workspaceId, workspaceId)));
    }
    return ligneVersNoteProspectVendeur(ligne);
  });
}
