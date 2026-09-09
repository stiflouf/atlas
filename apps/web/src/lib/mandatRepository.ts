import { asc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { biens as biensTable, mandats as mandatsTable, projetsVendeur as projetsVendeurTable } from "@/db/schema";
import type { Mandat } from "@/types/mandat";

// ADR-055 §F — accès au mandat canonique. Volontairement réduit à ce dont le lot a besoin : créer
// un mandat, le relire, lister ceux d'un bien ou d'un projet, et créer un successeur. Aucun geste de
// résiliation ni de pose de terme : ils n'existent nulle part dans le produit, et les écrire ici
// donnerait des chemins d'écriture que rien n'appelle.

type LigneMandat = typeof mandatsTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier : un mandat en cours n'a pas une date de résiliation nulle, il
// n'en a pas.
function ligneVersMandat(ligne: LigneMandat): Mandat {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    projetVendeurId: ligne.projetVendeurId ?? undefined,
    dateDebut: ligne.dateDebut,
    dateFin: ligne.dateFin ?? undefined,
    resilieLe: ligne.resilieLe ?? undefined,
    remplaceMandatId: ligne.remplaceMandatId ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

export type NouveauMandat = {
  bienId: string;
  // Optionnel : un mandat signé depuis une opportunité antérieure au modèle canonique n'a pas de
  // projet à référencer. Le mandat reste un fait ; son projet n'a jamais existé en base.
  projetVendeurId?: string;
  dateDebut: string;
  dateFin?: string;
  remplaceMandatId?: string;
};

// ADR-054 — `mandats` est une FEUILLE de `biens` : son périmètre est celui du bien, jamais un
// paramètre. Aucun `workspaceId` n'est donc reçu ici — le dupliquer permettrait d'en choisir un qui
// contredise le bien.
//
// En revanche, quand un projet est rattaché, les DEUX périmètres doivent coïncider : la base ne peut
// pas le vérifier (aucune des deux colonnes ne porte le workspace), donc ce chemin le fait, et il
// échoue bruyamment. Même garde et même raison que `ajouterPartieProjet`.
export async function creerMandat(input: NouveauMandat, executeur: Executeur = getDb()): Promise<Mandat> {
  const [bien] = await executeur
    .select({ workspaceId: biensTable.workspaceId })
    .from(biensTable)
    .where(eq(biensTable.id, input.bienId))
    .limit(1);
  if (!bien) throw new Error(`Bien introuvable : ${input.bienId}`);

  if (input.projetVendeurId !== undefined) {
    const [projet] = await executeur
      .select({ workspaceId: projetsVendeurTable.workspaceId })
      .from(projetsVendeurTable)
      .where(eq(projetsVendeurTable.id, input.projetVendeurId))
      .limit(1);
    if (!projet) throw new Error(`Projet vendeur introuvable : ${input.projetVendeurId}`);
    if (projet.workspaceId !== bien.workspaceId) {
      throw new Error("Un mandat ne peut pas relier un bien et un projet vendeur de workspaces différents");
    }
  }

  const [ligne] = await executeur
    .insert(mandatsTable)
    .values({
      bienId: input.bienId,
      projetVendeurId: input.projetVendeurId ?? null,
      dateDebut: input.dateDebut,
      dateFin: input.dateFin ?? null,
      remplaceMandatId: input.remplaceMandatId ?? null,
    })
    .returning();
  return ligneVersMandat(ligne);
}

// CAS 7 d'ADR-055 — un renouvellement CRÉE une ligne. Le mandat remplacé n'est jamais modifié :
// aucun UPDATE ici, aucune date de fin posée d'autorité sur lui. Clore l'ancien est un geste
// distinct, qui n'existe pas encore ; le supposer inventerait une fin de contrat que personne n'a
// constatée.
//
// Le successeur hérite du bien du mandat remplacé — un renouvellement porte par définition sur le
// même actif. Le laisser choisir au caller permettrait de « renouveler » un mandat sur un autre
// bien, ce qui ne serait pas un renouvellement.
export async function creerMandatSuccesseur(
  mandatRemplaceId: string,
  input: Omit<NouveauMandat, "bienId" | "remplaceMandatId">,
  executeur: Executeur = getDb()
): Promise<Mandat> {
  if (!UUID_REGEX.test(mandatRemplaceId)) throw new Error(`Mandat introuvable : ${mandatRemplaceId}`);
  const [remplace] = await executeur
    .select({ bienId: mandatsTable.bienId })
    .from(mandatsTable)
    .where(eq(mandatsTable.id, mandatRemplaceId))
    .limit(1);
  if (!remplace) throw new Error(`Mandat introuvable : ${mandatRemplaceId}`);

  return creerMandat({ ...input, bienId: remplace.bienId, remplaceMandatId: mandatRemplaceId }, executeur);
}

// Aucun filtrage par workspace en lecture : ce lot ne l'active pas, comme les précédents.
export async function getMandatById(id: string): Promise<Mandat | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(mandatsTable).where(eq(mandatsTable.id, id)).limit(1);
  return ligne ? ligneVersMandat(ligne) : undefined;
}

// Ordre chronologique de prise d'effet : l'historique contractuel se lit dans le sens où il s'est
// produit. Les mandats expirés ou résiliés ne sont jamais exclus — ce sont eux, l'historique.
export async function listerMandatsDuBien(bienId: string): Promise<Mandat[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await getDb()
    .select()
    .from(mandatsTable)
    .where(eq(mandatsTable.bienId, bienId))
    .orderBy(asc(mandatsTable.dateDebut), asc(mandatsTable.creeLe));
  return lignes.map(ligneVersMandat);
}

export async function listerMandatsDuProjetVendeur(projetVendeurId: string): Promise<Mandat[]> {
  if (!UUID_REGEX.test(projetVendeurId)) return [];
  const lignes = await getDb()
    .select()
    .from(mandatsTable)
    .where(eq(mandatsTable.projetVendeurId, projetVendeurId))
    .orderBy(asc(mandatsTable.dateDebut), asc(mandatsTable.creeLe));
  return lignes.map(ligneVersMandat);
}
