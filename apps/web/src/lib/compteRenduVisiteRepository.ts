import { and, desc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { biens as biensTable, comptesRendusVisite as comptesRendusVisiteTable, visites as visitesTable } from "@/db/schema";
import type { CompteRenduVisite, Interet } from "@/types/compteRenduVisite";
import type { Visite } from "@/types/visite";
import { verrouillerVisite, ligneVersVisitePublique } from "@/lib/visiteRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneCompteRendu = typeof comptesRendusVisiteTable.$inferSelect;

function ligneVersCompteRendu(ligne: LigneCompteRendu): CompteRenduVisite {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    visiteId: ligne.visiteId ?? undefined,
    dateVisite: ligne.dateVisite,
    retour: ligne.retour,
    interet: ligne.interet as Interet,
    prochaineEtape: ligne.prochaineEtape ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Lecture globale (VALUE-01), même exception documentée que listerVisites() (visiteRepository.ts) :
// volontairement NON scopée, mêmes appelants déjà globalement non scopés aujourd'hui.
export async function listerComptesRendus(): Promise<CompteRenduVisite[]> {
  try {
    const lignes = await getDb()
      .select()
      .from(comptesRendusVisiteTable)
      .orderBy(desc(comptesRendusVisiteTable.dateVisite));
    return lignes.map(ligneVersCompteRendu);
  } catch (erreur) {
    console.error("[comptes-rendus-visite] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function listerComptesRendusPourBien(
  bienId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<CompteRenduVisite[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await executeur
      .select({ compteRendu: comptesRendusVisiteTable })
      .from(comptesRendusVisiteTable)
      .innerJoin(biensTable, eq(comptesRendusVisiteTable.bienId, biensTable.id))
      .where(and(eq(comptesRendusVisiteTable.bienId, bienId), eq(biensTable.workspaceId, workspaceId)))
      .orderBy(desc(comptesRendusVisiteTable.dateVisite));
    return lignes.map((l) => ligneVersCompteRendu(l.compteRendu));
  } catch (erreur) {
    console.error("[comptes-rendus-visite] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function getCompteRenduVisiteById(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<CompteRenduVisite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select({ compteRendu: comptesRendusVisiteTable })
    .from(comptesRendusVisiteTable)
    .innerJoin(biensTable, eq(comptesRendusVisiteTable.bienId, biensTable.id))
    .where(and(eq(comptesRendusVisiteTable.id, id), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersCompteRendu(ligne.compteRendu) : undefined;
}

export async function getCompteRenduVisiteParVisiteId(
  visiteId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<CompteRenduVisite | undefined> {
  if (!UUID_REGEX.test(visiteId)) return undefined;
  const [ligne] = await executeur
    .select({ compteRendu: comptesRendusVisiteTable })
    .from(comptesRendusVisiteTable)
    .innerJoin(biensTable, eq(comptesRendusVisiteTable.bienId, biensTable.id))
    .where(and(eq(comptesRendusVisiteTable.visiteId, visiteId), eq(biensTable.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersCompteRendu(ligne.compteRendu) : undefined;
}

export type NouveauCompteRendu = Omit<CompteRenduVisite, "id" | "creeLe">;

// PRIMITIVE BASSE d'insertion pure, réservée à la composition de `creerCompteRenduEtRealiserVisite`
// ci-dessous et aux fixtures de test — jamais un chemin produit direct (même garde structurelle que
// enregistrerOffre/enregistrerCompromis, ADR-061).
export async function enregistrerCompteRenduVisite(
  input: NouveauCompteRendu,
  executeur: Executeur = getDb()
): Promise<CompteRenduVisite> {
  const [ligne] = await executeur
    .insert(comptesRendusVisiteTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      visiteId: input.visiteId ?? null,
      dateVisite: input.dateVisite,
      retour: input.retour,
      interet: input.interet,
      prochaineEtape: input.prochaineEtape ?? null,
    })
    .returning();
  return ligneVersCompteRendu(ligne);
}

export type ResultatCreationCompteRendu =
  | { statut: "cree"; compteRendu: CompteRenduVisite; visite: Visite | undefined; idsExecutionsATraiter: string[] }
  | { statut: "visite_deja_finalisee" }
  // WORKSPACE_SCOPING_V1 — une Visite a été DÉSIGNÉE mais ne se résout pas dans ce périmètre (id
  // inconnu, autre workspace, ou couple bien/acquéreur qui ne correspond pas). Avant, ce cas
  // enregistrait quand même un compte rendu « sans lien » avec les ids bruts soumis : c'était le
  // seul chemin d'écriture cross-workspace du domaine Visite. Refus typé, rien n'est écrit.
  | { statut: "visite_hors_perimetre" };

// Writer central (§16/§17/§18 du brief) : la création du compte rendu ET la transition éventuelle
// planifiee → realisee sont UNE seule transaction, sous le MÊME verrou que toute autre transition
// Visite (`verrouillerVisite`, visiteRepository.ts — jamais une seconde implémentation).
//
// `visiteId` optionnel (ADR-040, inchangé) : absent ou non résolu → compte rendu enregistré sans
// lien, exactement comme si aucune Visite Atlas n'existait pour ce cycle (aucune régression du
// chemin historique). Résolu MAIS déjà tranchée (`realisee`/`annulee`) au moment du verrou — que ce
// soit par un geste antérieur ou par une VRAIE course concurrente (§17/§18) — retourne
// `visite_deja_finalisee` SANS créer de second compte rendu : le perdant d'une double soumission
// n'obtient jamais un compte rendu orphelin dupliqué, un résultat typé contrôlé, jamais une erreur
// SQL brute (la contrainte `UNIQUE(visite_id)` reste un filet de défense en profondeur, jamais la
// garantie elle-même — c'est ce verrou qui la porte).
export async function creerCompteRenduEtRealiserVisite(
  input: NouveauCompteRendu,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationCompteRendu> {
  return executeur.transaction(async (tx) => {
    type VisiteVerrouilleeTrouvee = Extract<Awaited<ReturnType<typeof verrouillerVisite>>, { statut: "verrouille" }>;
    let visiteValide: VisiteVerrouilleeTrouvee["ligne"] | undefined;

    if (input.visiteId) {
      const verrou = await verrouillerVisite(input.visiteId, workspaceId, tx);
      if (verrou.statut !== "verrouille" || verrou.ligne.bienId !== input.bienId || verrou.ligne.acquereurId !== input.acquereurId) {
        // WORKSPACE_SCOPING_V1 — designer une Visite qu'on ne peut pas prouver dans ce périmètre
        // n'est plus enregistré « sans lien » : c'était le dernier chemin par lequel un compte rendu
        // pouvait naître d'ids bruts venus d'un autre workspace. Ne PAS soumettre de `visiteId` du
        // tout (compte rendu hors cycle ADR-040) reste parfaitement valide, et inchangé.
        return { statut: "visite_hors_perimetre" };
      }
      if (verrou.ligne.statut !== "planifiee") return { statut: "visite_deja_finalisee" };
      visiteValide = verrou.ligne;
    }

    const compteRendu = await enregistrerCompteRenduVisite({ ...input, visiteId: visiteValide?.id }, tx);

    let visite: Visite | undefined;
    if (visiteValide) {
      const [ligneMaj] = await tx
        .update(visitesTable)
        .set({ statut: "realisee", realiseeLe: new Date() })
        .where(and(eq(visitesTable.id, visiteValide.id), eq(visitesTable.statut, "planifiee")))
        .returning();
      if (ligneMaj) visite = ligneVersVisitePublique(ligneMaj);
    }

    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "visite_realisee", compteRenduVisiteId: compteRendu.id },
      workspaceId,
      tx
    );

    return { statut: "cree", compteRendu, visite, idsExecutionsATraiter };
  });
}
