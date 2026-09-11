import { eq, inArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, projetsAcquereur as projetsAcquereurTable } from "@/db/schema";

// ADR-055 §B — LA RÈGLE DE SOURCE des critères acquéreur, écrite UNE SEULE FOIS.
//
//   projet_acquereur_id présent  ->  le PROJET canonique fournit TOUS les champs qu'il porte
//   projet_acquereur_id absent   ->  le dossier historique fournit TOUS les champs
//
// Le repli est au niveau de l'AGRÉGAT, jamais du champ : un NULL canonique est une information
// (« ce critère n'est pas documenté »), pas un trou à combler avec la vieille valeur du dossier.
//
// Ce module ne connaît AUCUN consommateur. Deux projections s'appuient dessus, et ne dupliquent ni
// la requête ni la règle :
//   - `lib/compatibilite/profilCompatibiliteRepository` -> ce que le MOTEUR lit ;
//   - `lib/clientRepository` -> ce que l'ÉCRAN affiche et ce que le formulaire recharge.
// Les séparer permettait à l'affichage et au matching de diverger sur la même question ; les avoir
// écrites deux fois l'aurait garanti.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Les huit colonnes que `projets_acquereur` porte et que le Core déclare modifiables une par une
// (`ChampProjetAcquereurModifiable`). Ni `stadeProjet` ni `archiveLe` : le parcours commercial et le
// cycle de vie du DOSSIER restent lus et écrits sur `acquereurs` tant que leurs écrans n'ont pas
// basculé (dette nommée dans DATA_MODEL.md).
export type CriteresAcquereur = {
  budgetMin: number;
  budgetMax: number;
  criteres: string[];
  piecesMin?: number;
  surfaceMin?: number;
  accessibiliteRequise?: boolean;
  necessiteParking?: boolean;
  necessiteExterieur?: boolean;
};

// `source` n'est pas décoratif : les chemins d'ÉCRITURE en dépendent pour savoir où écrire, et le
// lire plutôt que le redéduire évite une seconde interprétation du pont.
export type SourceCriteres =
  | { source: "projet"; projetAcquereurId: string; criteres: CriteresAcquereur }
  | { source: "dossier" };

type LigneJointe = {
  acquereurId: string;
  projetAcquereurId: string | null;
  projetTrouveId: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  criteres: string[] | null;
  piecesMin: number | null;
  surfaceMin: number | null;
  accessibiliteRequise: boolean | null;
  necessiteParking: boolean | null;
  necessiteExterieur: boolean | null;
};

// NULL Postgres -> undefined métier, jamais false (même traduction que `ligneVersAcquereur` et
// `ligneVersProjet` : un critère non documenté n'est pas un refus).
function criteresDuProjet(ligne: LigneJointe): CriteresAcquereur {
  return {
    budgetMin: ligne.budgetMin!,
    budgetMax: ligne.budgetMax!,
    criteres: ligne.criteres!,
    piecesMin: ligne.piecesMin ?? undefined,
    surfaceMin: ligne.surfaceMin ?? undefined,
    accessibiliteRequise: ligne.accessibiliteRequise ?? undefined,
    necessiteParking: ligne.necessiteParking ?? undefined,
    necessiteExterieur: ligne.necessiteExterieur ?? undefined,
  };
}

// Une seule requête pour tout un lot, jamais une par acquéreur : ces fonctions sont appelées dans
// des croisements bien × acquéreur et dans des listes paginées.
export async function resoudreSourcesCriteres(
  acquereurIds: string[],
  executeur: Executeur = getDb()
): Promise<Map<string, SourceCriteres>> {
  const idsPersistes = acquereurIds.filter((id) => UUID_REGEX.test(id));
  if (idsPersistes.length === 0) return new Map();

  const lignes: LigneJointe[] = await executeur
    .select({
      acquereurId: acquereursTable.id,
      projetAcquereurId: acquereursTable.projetAcquereurId,
      projetTrouveId: projetsAcquereurTable.id,
      budgetMin: projetsAcquereurTable.budgetMin,
      budgetMax: projetsAcquereurTable.budgetMax,
      criteres: projetsAcquereurTable.criteres,
      piecesMin: projetsAcquereurTable.piecesMin,
      surfaceMin: projetsAcquereurTable.surfaceMin,
      accessibiliteRequise: projetsAcquereurTable.accessibiliteRequise,
      necessiteParking: projetsAcquereurTable.necessiteParking,
      necessiteExterieur: projetsAcquereurTable.necessiteExterieur,
    })
    .from(acquereursTable)
    .leftJoin(projetsAcquereurTable, eq(acquereursTable.projetAcquereurId, projetsAcquereurTable.id))
    .where(inArray(acquereursTable.id, idsPersistes));

  return new Map(
    lignes.map((ligne) => {
      // FAIL CLOSED. La FK `acquereurs.projet_acquereur_id -> projets_acquereur.id` rend ce cas
      // impossible ; y arriver signifie une incohérence de données, jamais un cas métier. Retomber
      // silencieusement sur le dossier afficherait — et ferait matcher — des critères périmés en
      // les présentant comme canoniques : un mensonge stable, bien pire qu'une erreur visible.
      if (ligne.projetAcquereurId !== null && ligne.projetTrouveId === null) {
        throw new Error(
          `Projet acquéreur référencé mais introuvable : acquereur ${ligne.acquereurId} -> projet ${ligne.projetAcquereurId}`
        );
      }
      const source: SourceCriteres =
        ligne.projetTrouveId === null
          ? { source: "dossier" }
          : { source: "projet", projetAcquereurId: ligne.projetTrouveId, criteres: criteresDuProjet(ligne) };
      return [ligne.acquereurId, source];
    })
  );
}

export async function resoudreSourceCriteres(
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<SourceCriteres> {
  // Absence de ligne : acquéreur non persisté (jeu de démonstration servi avant toute création
  // réelle, ids non-UUID) ou disparu entre deux lectures. Dans les deux cas le dossier en mémoire
  // est la seule donnée qui existe — exactement le comportement d'avant la bascule.
  return (await resoudreSourcesCriteres([acquereurId], executeur)).get(acquereurId) ?? { source: "dossier" };
}
