import { eq, inArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, projetsAcquereur as projetsAcquereurTable } from "@/db/schema";
import type { ProfilAcquereur } from "@/types/client";
import type { ProfilCompatibiliteAcquereur } from "@/types/profilCompatibiliteAcquereur";

// ADR-055 §B — RÉSOLUTION DE SOURCE des critères acquéreur, et rien d'autre. C'est le seul endroit
// du produit qui sait qu'un acquéreur peut avoir deux stockages de critères, et le moteur
// (evaluerCompatibilite.ts, criteres.ts) est écrit pour l'ignorer.
//
// LA RÈGLE, et elle est au niveau de l'AGRÉGAT :
//
//   projet_acquereur_id présent  ->  le PROJET canonique fournit TOUS les champs qu'il porte
//   projet_acquereur_id absent   ->  le dossier historique fournit TOUS les champs
//
// JAMAIS de repli champ par champ. Un `piecesMin` NULL sur un projet canonique est une
// information — « ce critère n'est pas documenté » — pas un trou à combler avec la vieille valeur
// du dossier. Reprendre le legacy champ à champ ressusciterait silencieusement un critère qu'une
// source externe vient précisément d'effacer, et rendrait indécidable ce que le produit affiche.
//
// Aucun backfill, aucune écriture : ce module lit. Les lignes historiques restent volontairement
// non rattachées (ADR-055) et continuent de matcher exactement comme avant.
//
// Ce que ce module NE fait PAS non plus : les SECTEURS DE RECHERCHE (ADR-035) restent une table
// enfant de `acquereurs`, chargée par `secteurRechercheRepository` à partir de l'id du dossier, et
// passée au moteur par les appelants comme avant. Le modèle de lecture effectif est donc HYBRIDE et
// assumé — critères canoniques quand un projet existe, enfants encore ancrés au dossier — jusqu'au
// lot qui canonicalisera ces enfants.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais false (même traduction que `ligneVersAcquereur` et
// `ligneVersProjet` : un critère non documenté n'est pas un refus).
type CritereProjet = {
  budgetMax: number;
  piecesMin: number | null;
  surfaceMin: number | null;
  accessibiliteRequise: boolean | null;
  necessiteParking: boolean | null;
  necessiteExterieur: boolean | null;
};

function profilDuProjet(acquereurId: string, projet: CritereProjet): ProfilCompatibiliteAcquereur {
  return {
    id: acquereurId,
    budgetMax: projet.budgetMax,
    piecesMin: projet.piecesMin ?? undefined,
    surfaceMin: projet.surfaceMin ?? undefined,
    accessibiliteRequise: projet.accessibiliteRequise ?? undefined,
    necessiteParking: projet.necessiteParking ?? undefined,
    necessiteExterieur: projet.necessiteExterieur ?? undefined,
  };
}

function profilDuDossier(acquereur: ProfilAcquereur): ProfilCompatibiliteAcquereur {
  return {
    id: acquereur.id,
    budgetMax: acquereur.budgetMax,
    piecesMin: acquereur.piecesMin,
    surfaceMin: acquereur.surfaceMin,
    accessibiliteRequise: acquereur.accessibiliteRequise,
    necessiteParking: acquereur.necessiteParking,
    necessiteExterieur: acquereur.necessiteExterieur,
  };
}

type Rattachement = { projetAcquereurId: string | null; projet: CritereProjet | undefined };

// Une seule requête pour tout le lot, jamais une par acquéreur : ces fonctions sont appelées dans
// des croisements bien × acquéreur (baseline, synchroniseur, écran Aujourd'hui) où une requête par
// acquéreur multiplierait les allers-retours par le nombre de dossiers.
async function lireRattachements(ids: string[], executeur: Executeur): Promise<Map<string, Rattachement>> {
  const lignes = await executeur
    .select({
      acquereurId: acquereursTable.id,
      projetAcquereurId: acquereursTable.projetAcquereurId,
      projetTrouveId: projetsAcquereurTable.id,
      budgetMax: projetsAcquereurTable.budgetMax,
      piecesMin: projetsAcquereurTable.piecesMin,
      surfaceMin: projetsAcquereurTable.surfaceMin,
      accessibiliteRequise: projetsAcquereurTable.accessibiliteRequise,
      necessiteParking: projetsAcquereurTable.necessiteParking,
      necessiteExterieur: projetsAcquereurTable.necessiteExterieur,
    })
    .from(acquereursTable)
    .leftJoin(projetsAcquereurTable, eq(acquereursTable.projetAcquereurId, projetsAcquereurTable.id))
    .where(inArray(acquereursTable.id, ids));

  return new Map(
    lignes.map((ligne) => [
      ligne.acquereurId,
      {
        projetAcquereurId: ligne.projetAcquereurId,
        projet:
          ligne.projetTrouveId === null
            ? undefined
            : {
                budgetMax: ligne.budgetMax!,
                piecesMin: ligne.piecesMin,
                surfaceMin: ligne.surfaceMin,
                accessibiliteRequise: ligne.accessibiliteRequise,
                necessiteParking: ligne.necessiteParking,
                necessiteExterieur: ligne.necessiteExterieur,
              },
      },
    ])
  );
}

function resoudreUn(acquereur: ProfilAcquereur, rattachement: Rattachement | undefined): ProfilCompatibiliteAcquereur {
  // Aucune ligne lue pour cet id : soit l'acquéreur n'est pas persisté (jeu de démonstration servi
  // par listerClients() avant toute création réelle, ids non-UUID), soit il a disparu entre le
  // chargement et ici. Dans les deux cas le dossier en mémoire est la seule donnée qui existe —
  // c'est exactement le comportement d'avant ce lot, pour un acquéreur qui n'a de toute façon
  // aucun projet canonique.
  if (!rattachement) return profilDuDossier(acquereur);

  // FAIL CLOSED. La FK `acquereurs.projet_acquereur_id -> projets_acquereur.id` rend ce cas
  // impossible ; y arriver signifie une incohérence de données, jamais un cas métier. Retomber
  // silencieusement sur le legacy ferait matcher sur des critères périmés en présentant le
  // résultat comme canonique — un mensonge stable, bien pire qu'une erreur visible.
  if (rattachement.projetAcquereurId !== null && rattachement.projet === undefined) {
    throw new Error(
      `Projet acquéreur référencé mais introuvable : acquereur ${acquereur.id} -> projet ${rattachement.projetAcquereurId}`
    );
  }

  return rattachement.projet ? profilDuProjet(acquereur.id, rattachement.projet) : profilDuDossier(acquereur);
}

// Ordre d'entrée préservé : les appelants alignent le résultat sur leur propre liste d'acquéreurs.
export async function resoudreProfilsCompatibilite(
  acquereurs: ProfilAcquereur[],
  executeur: Executeur = getDb()
): Promise<ProfilCompatibiliteAcquereur[]> {
  const idsPersistes = acquereurs.map((a) => a.id).filter((id) => UUID_REGEX.test(id));
  if (idsPersistes.length === 0) return acquereurs.map(profilDuDossier);
  const rattachements = await lireRattachements(idsPersistes, executeur);
  return acquereurs.map((acquereur) => resoudreUn(acquereur, rattachements.get(acquereur.id)));
}

export async function resoudreProfilCompatibilite(
  acquereur: ProfilAcquereur,
  executeur: Executeur = getDb()
): Promise<ProfilCompatibiliteAcquereur> {
  const [profil] = await resoudreProfilsCompatibilite([acquereur], executeur);
  return profil;
}
