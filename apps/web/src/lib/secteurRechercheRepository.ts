import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { secteursRechercheAcquereur as secteursTable } from "@/db/schema";
import type { SecteurRecherche } from "@/types/secteurRecherche";
import type { Commune } from "@/types/geocodage";

type LigneSecteur = typeof secteursTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ligneVersSecteur(ligne: LigneSecteur): SecteurRecherche {
  return {
    id: ligne.id,
    acquereurId: ligne.acquereurId,
    codeInsee: ligne.codeInsee,
    nomCommune: ligne.nomCommune,
    codePostal: ligne.codePostal,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Aucun repli mock : un secteur n'existe que pour un acquéreur réel (FK uuid), même principe que
// noteBienRepository.listerNotesPourBien / noteProspectVendeurRepository.
export async function listerSecteursPourAcquereur(acquereurId: string): Promise<SecteurRecherche[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  const lignes = await getDb().select().from(secteursTable).where(eq(secteursTable.acquereurId, acquereurId));
  return lignes.map(ligneVersSecteur);
}

// Chargement groupé (ADR-034/035, section 15) — une seule requête pour N acquéreurs, jamais une
// requête par acquéreur dans une boucle d'orchestration. Retourne une Map indexée par
// acquereurId ; une clé absente équivaut à "aucun secteur" (pas d'entrée vide insérée), l'appelant
// doit utiliser `?? []` à la lecture.
export async function listerSecteursPourAcquereurs(
  acquereurIds: string[]
): Promise<Map<string, SecteurRecherche[]>> {
  const idsValides = acquereurIds.filter((id) => UUID_REGEX.test(id));
  const resultat = new Map<string, SecteurRecherche[]>();
  if (idsValides.length === 0) return resultat;

  const lignes = await getDb().select().from(secteursTable).where(inArray(secteursTable.acquereurId, idsValides));
  for (const ligne of lignes) {
    const secteur = ligneVersSecteur(ligne);
    const liste = resultat.get(secteur.acquereurId) ?? [];
    liste.push(secteur);
    resultat.set(secteur.acquereurId, liste);
  }
  return resultat;
}

// Insertion pure : `commune` doit déjà avoir été vérifiée fraîchement auprès de l'IGN par
// l'appelant (verifierCommune, ADR-035 section 8) — ce repository ne refait jamais cette
// vérification et ne fait confiance à aucune valeur non contrôlée. La contrainte UNIQUE
// (acquereur_id, code_insee) fait échouer l'insertion (erreur Postgres 23505) en cas de doublon —
// à l'appelant (Server Action) de la traduire en message actionnable, jamais absorbée
// silencieusement ici.
export async function ajouterSecteurRecherche(
  acquereurId: string,
  commune: Commune,
  executeur: Executeur = getDb()
): Promise<SecteurRecherche> {
  const [ligne] = await executeur
    .insert(secteursTable)
    .values({
      acquereurId,
      codeInsee: commune.citycode,
      nomCommune: commune.nom,
      codePostal: commune.codePostal,
    })
    .returning();
  return ligneVersSecteur(ligne);
}

// Suppression scoped à l'acquéreur propriétaire (acquereur_id dans la clause WHERE, pas seulement
// l'id de la ligne) : un formulaire manipulé sur la fiche d'un acquéreur ne peut jamais supprimer
// le secteur d'un autre acquéreur. Retourne undefined si aucune ligne ne correspond (id inconnu,
// ou id existant mais n'appartenant pas à acquereurId) plutôt que de supposer une suppression
// effective.
export async function supprimerSecteurRecherche(
  id: string,
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<SecteurRecherche | undefined> {
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(acquereurId)) return undefined;
  const [ligne] = await executeur
    .delete(secteursTable)
    .where(and(eq(secteursTable.id, id), eq(secteursTable.acquereurId, acquereurId)))
    .returning();
  return ligne ? ligneVersSecteur(ligne) : undefined;
}
