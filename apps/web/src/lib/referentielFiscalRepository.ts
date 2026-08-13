import { and, desc, eq, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { regleFiscale as regleFiscaleTable } from "@/db/schema";
import type { NouvelleRegleFiscale, RegleFiscale } from "@/types/regleFiscale";

type LigneRegleFiscale = typeof regleFiscaleTable.$inferSelect;

function ligneVersRegleFiscale(ligne: LigneRegleFiscale): RegleFiscale {
  return {
    id: ligne.id,
    code: ligne.code,
    categorieActivite: ligne.categorieActivite,
    valeur: ligne.valeur,
    unite: ligne.unite as RegleFiscale["unite"],
    dateDebutValidite: ligne.dateDebutValidite,
    dateFinValidite: ligne.dateFinValidite ?? undefined,
    sourceLibelle: ligne.sourceLibelle,
    sourceUrl: ligne.sourceUrl,
    datePublicationSource: ligne.datePublicationSource ?? undefined,
    statutVerification: ligne.statutVerification as RegleFiscale["statutVerification"],
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Convention temporelle (ADR-023, point 5) : intervalle semi-ouvert [debut, fin[ — fin exclue,
// undefined = pas de fin connue (+infini). Comparaison lexicale de chaînes 'YYYY-MM-DD' : valide
// tant que les dates restent au format ISO stocké par Postgres/Drizzle (mode "string" des colonnes
// date), jamais un objet Date construit pour cette comparaison.
export function intervallesSeChevauchent(
  aDebut: string,
  aFin: string | undefined,
  bDebut: string,
  bFin: string | undefined
): boolean {
  const aCommenceAvantBFin = bFin === undefined || aDebut < bFin;
  const bCommenceAvantAFin = aFin === undefined || bDebut < aFin;
  return aCommenceAvantBFin && bCommenceAvantAFin;
}

// Règle applicable à la date D pour (code, categorieActivite) : la plus récente dont
// dateDebutValidite <= D et dont dateFinValidite (exclusive) ne l'a pas encore dépassée. Retourne
// undefined si aucune règle ne couvre cette date — jamais une valeur par défaut. statutVerification
// est toujours retourné avec la règle, jamais filtré : c'est à l'appelant (futur moteur de calcul,
// ADR-024) de refuser un résultat "officiel" si elle vaut autre chose que 'verifie_direct'.
export async function resoudreRegle(
  code: string,
  categorieActivite: string,
  date: string
): Promise<RegleFiscale | undefined> {
  const lignes = await getDb()
    .select()
    .from(regleFiscaleTable)
    .where(
      and(
        eq(regleFiscaleTable.code, code),
        eq(regleFiscaleTable.categorieActivite, categorieActivite),
        lte(regleFiscaleTable.dateDebutValidite, date)
      )
    )
    .orderBy(desc(regleFiscaleTable.dateDebutValidite));

  // Filtre en mémoire sur la borne de fin exclusive (NULL = +infini, pas exprimable proprement en
  // un seul WHERE sans dupliquer la logique) — le nombre de lignes par (code, categorieActivite)
  // reste minuscule (quelques dizaines au plus), pas de souci de performance.
  const applicable = lignes.find((ligne) => ligne.dateFinValidite === null || ligne.dateFinValidite > date);
  return applicable ? ligneVersRegleFiscale(applicable) : undefined;
}

export async function listerHistoriqueRegle(code: string, categorieActivite: string): Promise<RegleFiscale[]> {
  const lignes = await getDb()
    .select()
    .from(regleFiscaleTable)
    .where(and(eq(regleFiscaleTable.code, code), eq(regleFiscaleTable.categorieActivite, categorieActivite)))
    .orderBy(regleFiscaleTable.dateDebutValidite);
  return lignes.map(ligneVersRegleFiscale);
}

// Seul chemin d'écriture du référentiel (script de seed — aucune Server Action utilisateur).
// Rejette explicitement tout chevauchement avec une règle existante du même (code,
// categorieActivite) : deux règles ne doivent jamais se chevaucher (point 5). Pas de CHECK SQL
// inter-lignes pour cette validation — le volume d'écriture (seed contrôlé, jamais concurrent)
// rend une garde applicative suffisante et plus lisible qu'une contrainte EXCLUDE PostgreSQL.
export async function insererRegleFiscale(input: NouvelleRegleFiscale): Promise<RegleFiscale> {
  const existantes = await getDb()
    .select()
    .from(regleFiscaleTable)
    .where(and(eq(regleFiscaleTable.code, input.code), eq(regleFiscaleTable.categorieActivite, input.categorieActivite)));

  const chevauchement = existantes.find((ligne) =>
    intervallesSeChevauchent(
      input.dateDebutValidite,
      input.dateFinValidite,
      ligne.dateDebutValidite,
      ligne.dateFinValidite ?? undefined
    )
  );
  if (chevauchement) {
    throw new Error(
      `Chevauchement détecté pour ${input.code}/${input.categorieActivite} : la période ` +
        `[${input.dateDebutValidite}, ${input.dateFinValidite ?? "∞"}[ recoupe une règle existante ` +
        `[${chevauchement.dateDebutValidite}, ${chevauchement.dateFinValidite ?? "∞"}[.`
    );
  }

  const [ligne] = await getDb()
    .insert(regleFiscaleTable)
    .values({
      code: input.code,
      categorieActivite: input.categorieActivite,
      valeur: input.valeur,
      unite: input.unite,
      dateDebutValidite: input.dateDebutValidite,
      dateFinValidite: input.dateFinValidite ?? null,
      sourceLibelle: input.sourceLibelle,
      sourceUrl: input.sourceUrl,
      datePublicationSource: input.datePublicationSource ?? null,
      statutVerification: input.statutVerification,
    })
    .returning();
  return ligneVersRegleFiscale(ligne);
}
