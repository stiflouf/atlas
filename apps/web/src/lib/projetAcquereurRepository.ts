import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { projetsAcquereur as projetsAcquereurTable } from "@/db/schema";
import { enqueuerResynchronisationProjetAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import type { StadeProjet } from "@/types/client";
import type { ChampProjetAcquereurModifiable, ProjetAcquereur } from "@/types/projetAcquereur";

// ADR-055 §B — accès au projet acquéreur canonique. Les parties de projet vivent dans
// `partieProjetRepository.ts` depuis que les projets vendeur existent : la relation est partagée
// par les deux côtés, et la garder ici en ferait un vocabulaire acquéreur qu'elle n'est plus.

type LigneProjet = typeof projetsAcquereurTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais false : un critère non documenté n'est pas un refus
// (même traduction que ligneVersAcquereur).
function ligneVersProjet(ligne: LigneProjet): ProjetAcquereur {
  return {
    id: ligne.id,
    budgetMin: ligne.budgetMin,
    budgetMax: ligne.budgetMax,
    criteres: ligne.criteres,
    stadeProjet: ligne.stadeProjet as StadeProjet,
    piecesMin: ligne.piecesMin ?? undefined,
    surfaceMin: ligne.surfaceMin ?? undefined,
    accessibiliteRequise: ligne.accessibiliteRequise ?? undefined,
    necessiteParking: ligne.necessiteParking ?? undefined,
    necessiteExterieur: ligne.necessiteExterieur ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    archiveLe: ligne.archiveLe?.toISOString(),
  };
}

export type NouveauProjetAcquereur = Omit<ProjetAcquereur, "id" | "creeLe" | "archiveLe">;

// `workspaceId` est un paramètre OBLIGATOIRE (ADR-054) : il vient du contexte authentifié, jamais
// d'un littéral. `executeur` optionnel, même patron que `creerAcquereur`/`creerContact` : permet de
// créer le projet dans la même transaction que le contact et le dossier historique.
export async function creerProjetAcquereur(
  input: NouveauProjetAcquereur,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProjetAcquereur> {
  const [ligne] = await executeur
    .insert(projetsAcquereurTable)
    .values({
      workspaceId,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      criteres: input.criteres,
      stadeProjet: input.stadeProjet,
      piecesMin: input.piecesMin ?? null,
      surfaceMin: input.surfaceMin ?? null,
      accessibiliteRequise: input.accessibiliteRequise ?? null,
      necessiteParking: input.necessiteParking ?? null,
      necessiteExterieur: input.necessiteExterieur ?? null,
    })
    .returning();
  return ligneVersProjet(ligne);
}

// Aucun filtrage par workspace en lecture : ce lot ne l'active pas (il reste un lot à part entière,
// pour pouvoir en caractériser les régressions séparément). Même choix que `getContactById`.
export async function getProjetAcquereurById(
  id: string,
  // `executeur` optionnel, même patron que partout ailleurs : permet de relire le projet DANS la
  // transaction qui va l'écrire, sans décider à partir d'un état lu avant elle.
  executeur: Executeur = getDb()
): Promise<ProjetAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select()
    .from(projetsAcquereurTable)
    .where(eq(projetsAcquereurTable.id, id))
    .limit(1);
  return ligne ? ligneVersProjet(ligne) : undefined;
}

// Écriture CIBLÉE d'un seul champ, avec un mapping EXPLICITE champ -> colonne. Jamais
// `.set({ [champ]: valeur })` : un nom de colonne venu de l'extérieur, même filtré en amont,
// transforme ce repository en interpréteur générique — et la première fois qu'un appelant oublie
// de filtrer, n'importe quelle colonne devient inscriptible.
//
// Le `switch` est exhaustif par construction : ajouter un champ modifiable sans l'écrire ici ne
// compile pas (`ChampProjetAcquereurModifiable` est fermé, et le `never` final le prouve).
//
// INVARIANT MÉTIER vérifié ici, et non laissé à Postgres : `budgetMin <= budgetMax`. Le schéma ne
// le contraint pas, et la validation vivait jusqu'ici dans la Server Action de saisie — un chemin
// d'écriture qui ne passe pas par elle doit donc porter la règle, sinon une source externe pourrait
// écrire un intervalle impossible un champ à la fois. Retourne `undefined` quand la règle est
// violée : l'appelant en fait un refus explicite, jamais une écriture partielle.
export async function modifierChampProjetAcquereur(
  id: string,
  champ: ChampProjetAcquereurModifiable,
  valeur: unknown,
  executeur: Executeur = getDb()
): Promise<ProjetAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [actuel] = await executeur
    .select()
    .from(projetsAcquereurTable)
    .where(eq(projetsAcquereurTable.id, id))
    .limit(1);
  if (!actuel) return undefined;

  const budgetMin = champ === "budgetMin" ? (valeur as number) : actuel.budgetMin;
  const budgetMax = champ === "budgetMax" ? (valeur as number) : actuel.budgetMax;
  if (budgetMin > budgetMax) return undefined;

  const valeurs = (() => {
    switch (champ) {
      case "budgetMin":
        return { budgetMin: valeur as number };
      case "budgetMax":
        return { budgetMax: valeur as number };
      case "criteres":
        return { criteres: valeur as string[] };
      case "piecesMin":
        return { piecesMin: (valeur as number | null) ?? null };
      case "surfaceMin":
        return { surfaceMin: (valeur as number | null) ?? null };
      case "accessibiliteRequise":
        return { accessibiliteRequise: (valeur as boolean | null) ?? null };
      case "necessiteParking":
        return { necessiteParking: (valeur as boolean | null) ?? null };
      case "necessiteExterieur":
        return { necessiteExterieur: (valeur as boolean | null) ?? null };
      default: {
        const jamais: never = champ;
        throw new Error(`Champ synchronisable non géré : ${String(jamais)}`);
      }
    }
  })();

  const [ligne] = await executeur
    .update(projetsAcquereurTable)
    .set(valeurs)
    .where(eq(projetsAcquereurTable.id, id))
    .returning();
  if (!ligne) return undefined;

  // INVALIDATION, portée par le writer Core lui-même et non par ses appelants. Depuis ADR-055 §B,
  // ces colonnes sont les critères que le moteur de compatibilité lit réellement : les modifier
  // sans demander de recalcul laisserait le produit afficher un statut périmé. La poser ici plutôt
  // que dans le Sync Engine tient la frontière d'ADR-056 §9 — une source externe pousse une valeur
  // au Core et n'a jamais à savoir qu'un moteur de matching existe.
  //
  // Le writer legacy équivalent (`modifierAcquereur`) laisse cette responsabilité à sa Server
  // Action, qui a une session, une transaction et un `workspaceId` sous la main. Ce chemin-ci n'a
  // rien de tout cela : son appelant peut être une machine, et l'oubli y serait invisible.
  await enqueuerResynchronisationProjetAcquereur(id, executeur);

  return ligneVersProjet(ligne);
}
