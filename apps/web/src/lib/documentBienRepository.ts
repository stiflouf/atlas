import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentsBien as documentsBienTable } from "@/db/schema";
import type {
  CategorieDocument,
  ChampsCorrectionDocumentBien,
  DocumentBien,
  EtatVerificationDocument,
  TypeDocument,
} from "@/types/documentBien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneDocumentBien = typeof documentsBienTable.$inferSelect;

function ligneVersDocumentBien(ligne: LigneDocumentBien): DocumentBien {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    nom: ligne.nom,
    categorie: ligne.categorie as CategorieDocument,
    nomFichierOriginal: ligne.nomFichierOriginal,
    cleStockage: ligne.cleStockage,
    tailleOctets: ligne.tailleOctets,
    typeMime: ligne.typeMime,
    creeLe: ligne.creeLe.toISOString(),
    typeDocument: (ligne.typeDocument as TypeDocument | null) ?? undefined,
    typeDocumentDetail: ligne.typeDocumentDetail ?? undefined,
    dateDocument: ligne.dateDocument ?? undefined,
    dateFinValidite: ligne.dateFinValidite ?? undefined,
    compromisId: ligne.compromisId ?? undefined,
    acquereurId: ligne.acquereurId ?? undefined,
    prospectVendeurId: ligne.prospectVendeurId ?? undefined,
    coproprieteDeclaree: ligne.coproprieteDeclaree ?? undefined,
    adresseDeclaree: ligne.adresseDeclaree ?? undefined,
    provenance: ligne.provenance ?? undefined,
    etatVerification: ligne.etatVerification as EtatVerificationDocument,
    modifieLe: ligne.modifieLe?.toISOString() ?? undefined,
  };
}

// Pas de repli mock : un document n'existe que pour un bien réel (FK uuid), il n'y a pas de
// dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien mocké) ne peut
// correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerDocumentsPourBien(bienId: string): Promise<DocumentBien[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(documentsBienTable)
      .where(eq(documentsBienTable.bienId, bienId))
      .orderBy(desc(documentsBienTable.creeLe));
    return lignes.map(ligneVersDocumentBien);
  } catch (erreur) {
    console.error("[documents-bien] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution directe par id, utilisée par le Route Handler de téléchargement — continue de
// résoudre un document même si le bien associé a depuis été archivé (ADR-012), jamais si le bien
// mocké n'a pas d'id UUID.
export async function getDocumentBienById(id: string): Promise<DocumentBien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await getDb().select().from(documentsBienTable).where(eq(documentsBienTable.id, id));
    return ligne ? ligneVersDocumentBien(ligne) : undefined;
  } catch (erreur) {
    console.error("[documents-bien] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// Validation (nom non vide, type MIME et taille contrôlés, bien non archivé, cohérence des
// rattachements — ADR-029) déjà faite par l'appelant (Server Action), écriture du fichier sur
// disque déjà faite avant cet appel (src/lib/stockageDocuments.ts) — insertion pure ici, même
// principe que les autres repositories.
export type NouveauDocumentBien = Omit<DocumentBien, "id" | "creeLe" | "modifieLe">;

export async function enregistrerDocumentBien(input: NouveauDocumentBien): Promise<DocumentBien> {
  const [ligne] = await getDb()
    .insert(documentsBienTable)
    .values({
      bienId: input.bienId,
      nom: input.nom,
      categorie: input.categorie,
      nomFichierOriginal: input.nomFichierOriginal,
      cleStockage: input.cleStockage,
      tailleOctets: input.tailleOctets,
      typeMime: input.typeMime,
      typeDocument: input.typeDocument ?? null,
      typeDocumentDetail: input.typeDocumentDetail ?? null,
      dateDocument: input.dateDocument ?? null,
      dateFinValidite: input.dateFinValidite ?? null,
      compromisId: input.compromisId ?? null,
      acquereurId: input.acquereurId ?? null,
      prospectVendeurId: input.prospectVendeurId ?? null,
      coproprieteDeclaree: input.coproprieteDeclaree ?? null,
      adresseDeclaree: input.adresseDeclaree ?? null,
      provenance: input.provenance ?? null,
      etatVerification: input.etatVerification,
    })
    .returning();
  return ligneVersDocumentBien(ligne);
}

// Correction de classement (ADR-029) : remplacement complet des champs corrigibles, jamais un
// patch partiel — même contrat que remunerationRepository.modifierRemunerationPrevisionnelle
// (ADR-021). Ne touche jamais nomFichierOriginal/cleStockage/tailleOctets/typeMime/creeLe (le
// fichier reste immuable, ADR-013). La cohérence des rattachements (compromisId/acquereurId/
// prospectVendeurId vs bienId) est vérifiée par l'appelant AVANT cet appel
// (validerCoherenceRattachementsDocument) — insertion/update pure ici.
export async function corrigerClassementDocumentBien(
  id: string,
  champs: ChampsCorrectionDocumentBien
): Promise<DocumentBien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(documentsBienTable)
    .set({
      bienId: champs.bienId,
      nom: champs.nom,
      categorie: champs.categorie,
      typeDocument: champs.typeDocument,
      typeDocumentDetail: champs.typeDocumentDetail,
      dateDocument: champs.dateDocument,
      dateFinValidite: champs.dateFinValidite,
      compromisId: champs.compromisId,
      acquereurId: champs.acquereurId,
      prospectVendeurId: champs.prospectVendeurId,
      coproprieteDeclaree: champs.coproprieteDeclaree,
      adresseDeclaree: champs.adresseDeclaree,
      provenance: champs.provenance,
      etatVerification: champs.etatVerification,
      modifieLe: new Date(),
    })
    .where(eq(documentsBienTable.id, id))
    .returning();
  return ligne ? ligneVersDocumentBien(ligne) : undefined;
}
