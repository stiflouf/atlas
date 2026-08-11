import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { biens as biensTable } from "@/db/schema";
import { biens as biensDemo, getBienById as getBienDemoById } from "@/data/biens";
import type { Bien, TypeBien, StatutMandat, Exterieur } from "@/types/bien";

type LigneBien = typeof biensTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais interprété comme false/"aucun" : c'est la seule
// traduction qui préserve la sémantique "champ absent = inconnu" au-delà de la frontière DB.
function ligneVersBien(ligne: LigneBien): Bien {
  return {
    id: ligne.id,
    reference: ligne.reference,
    titre: ligne.titre,
    type: ligne.type as TypeBien,
    adresse: ligne.adresse,
    ville: ligne.ville,
    codePostal: ligne.codePostal,
    surface: ligne.surface,
    pieces: ligne.pieces,
    prix: ligne.prix,
    statutMandat: ligne.statutMandat as StatutMandat,
    dateMandat: ligne.dateMandat,
    caracteristiques: ligne.caracteristiques,
    description: ligne.description,
    etage: ligne.etage ?? undefined,
    ascenseur: ligne.ascenseur ?? undefined,
    parking: ligne.parking ?? undefined,
    exterieur: (ligne.exterieur as Exterieur | null) ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Biens réels si au moins un existe, sinon les biens de démonstration — jamais un mélange : une
// fois un premier bien réel créé, le pool de correspondance floue ne doit plus jamais inclure de
// biens fictifs.
export async function listerBiens(): Promise<Bien[]> {
  try {
    const lignes = await getDb().select().from(biensTable);
    if (lignes.length > 0) return lignes.map(ligneVersBien);
  } catch (erreur) {
    console.error("[biens] lecture Postgres indisponible, repli sur les mocks :", erreur);
  }
  return biensDemo;
}

// Suit le même état global que listerBiens() : si au moins un bien réel existe, le repli mock
// est désactivé même pour un lookup par id direct (ex. "bien-001" dans une URL) — pour ne jamais
// réintroduire silencieusement un bien fictif dans une session déjà passée en réel. Seule
// exception : une panne d'accès à la base elle-même, où le repli reste le comportement le plus
// sûr (cohérent avec le reste de l'app).
export async function getBienById(id: string): Promise<Bien | undefined> {
  try {
    if (UUID_REGEX.test(id)) {
      const [ligne] = await getDb().select().from(biensTable).where(eq(biensTable.id, id)).limit(1);
      if (ligne) return ligneVersBien(ligne);
    }

    const [{ total }] = await getDb().select({ total: sql<number>`count(*)::int` }).from(biensTable);
    if (total > 0) return undefined;
  } catch (erreur) {
    console.error("[biens] lecture Postgres indisponible, repli sur les mocks :", erreur);
    return getBienDemoById(id);
  }
  return getBienDemoById(id);
}

export type NouveauBien = Omit<Bien, "id">;

// Insertion pure : la validation métier (surface > 0, prix >= 0, etc.) est de la responsabilité
// de l'appelant (Server Action), pas de ce repository.
export async function creerBien(input: NouveauBien): Promise<Bien> {
  const [ligne] = await getDb()
    .insert(biensTable)
    .values({
      reference: input.reference,
      titre: input.titre,
      type: input.type,
      adresse: input.adresse,
      ville: input.ville,
      codePostal: input.codePostal,
      surface: input.surface,
      pieces: input.pieces,
      prix: input.prix,
      statutMandat: input.statutMandat,
      dateMandat: input.dateMandat,
      caracteristiques: input.caracteristiques,
      description: input.description,
      etage: input.etage ?? null,
      ascenseur: input.ascenseur ?? null,
      parking: input.parking ?? null,
      exterieur: input.exterieur ?? null,
    })
    .returning();
  return ligneVersBien(ligne);
}
