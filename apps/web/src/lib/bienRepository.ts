import { eq, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { biens as biensTable } from "@/db/schema";
import { biens as biensDemo, getBienById as getBienDemoById } from "@/data/biens";
import type { Bien, TypeBien, StatutMandat, Exterieur, ChargeHonoraires } from "@/types/bien";

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
    nomCopropriete: ligne.nomCopropriete ?? undefined,
    chargeHonoraires: (ligne.chargeHonoraires as ChargeHonoraires | null) ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    archiveLe: ligne.archiveLe?.toISOString(),
    offreEnCoursLe: ligne.offreEnCoursLe?.toISOString(),
    compromisSigneLe: ligne.compromisSigneLe?.toISOString(),
  };
}

// Biens réels si au moins un existe, sinon les biens de démonstration — jamais un mélange : une
// fois un premier bien réel créé, le pool de correspondance floue ne doit plus jamais inclure de
// biens fictifs. La bascule elle-même compte TOUTES les lignes réelles (archivées comprises) —
// seul le résultat retourné exclut les archivés (ADR-012) : un catalogue entièrement archivé ne
// doit jamais retomber sur les mocks.
export async function listerBiens(): Promise<Bien[]> {
  try {
    const lignes = await getDb().select().from(biensTable);
    if (lignes.length > 0) return lignes.filter((l) => !l.archiveLe).map(ligneVersBien);
  } catch (erreur) {
    console.error("[biens] lecture Postgres indisponible, repli sur les mocks :", erreur);
  }
  return biensDemo;
}

// Réservé aux biens réels archivés — aucun repli mock (un bien mocké ne peut pas être archivé).
export async function listerBiensArchives(): Promise<Bien[]> {
  try {
    const lignes = await getDb().select().from(biensTable);
    return lignes.filter((l) => l.archiveLe).map(ligneVersBien);
  } catch (erreur) {
    console.error("[biens] lecture Postgres indisponible :", erreur);
    return [];
  }
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
// de l'appelant (Server Action), pas de ce repository. `executeur` optionnel (même principe que
// marquerOffreEnCours, ADR-019) : permet d'appeler cette fonction à l'intérieur d'une transaction
// ouverte ailleurs — voir prospectVendeurRepository.signerMandatProspectVendeur (ADR-027), qui
// crée le bien et pose le jalon de conversion dans une seule transaction atomique.
export async function creerBien(input: NouveauBien, executeur: Executeur = getDb()): Promise<Bien> {
  const [ligne] = await executeur
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
      nomCopropriete: input.nomCopropriete ?? null,
      chargeHonoraires: input.chargeHonoraires ?? null,
    })
    .returning();
  return ligneVersBien(ligne);
}

// Update pur, même principe que creerBien : validation métier déjà faite par l'appelant.
// modifieLe est posé explicitement — Drizzle .defaultNow() ne s'applique qu'à l'insertion, une
// mise à jour ne le rafraîchit jamais automatiquement. Retourne undefined si id ne correspond à
// aucune ligne réelle (id mocké ou déjà supprimé) plutôt que de supposer qu'une ligne a été
// modifiée — l'appelant (Server Action) doit gérer ce cas explicitement, jamais un faux succès.
export async function modifierBien(id: string, input: NouveauBien): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(biensTable)
    .set({
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
      nomCopropriete: input.nomCopropriete ?? null,
      chargeHonoraires: input.chargeHonoraires ?? null,
      modifieLe: new Date(),
    })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}

// Archivage/désarchivage : jamais un DELETE, uniquement archiveLe qui bascule. N'affecte aucune
// FK (notes_bien, comptes_rendus_visite) ni les colonnes text sans contrainte (actions,
// memoire_contextuelle) — un UPDATE ne déclenche jamais ON DELETE CASCADE.
export async function archiverBien(id: string): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(biensTable)
    .set({ archiveLe: new Date() })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}

export async function desarchiverBien(id: string): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(biensTable)
    .set({ archiveLe: null })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}

// Jalons du statut commercial (ADR-014) : insertion pure, aucune garde métier interne — la
// validation (compromis non actif pour retirerOffre, bien non archivé) est de la responsabilité
// de la Server Action appelante, même séparation que archiverBien/desarchiverBien.
// `executeur` optionnel : permet d'appeler cette fonction à l'intérieur d'une transaction ouverte
// ailleurs (voir offreRepository.enregistrerOffreAvecLiensEtJalon, ADR-019).
export async function marquerOffreEnCours(id: string, executeur: Executeur = getDb()): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(biensTable)
    .set({ offreEnCoursLe: new Date() })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}

export async function retirerOffre(id: string): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(biensTable)
    .set({ offreEnCoursLe: null })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}

// `executeur` optionnel (ADR-032) : permet de poser ce jalon dans la même transaction que
// `compromisRepository.enregistrerCompromis` et l'émission de l'événement `compromis_signe`
// (voir `ajouterCompromisAction`, désormais transactionnel).
export async function marquerCompromisSigne(id: string, executeur: Executeur = getDb()): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(biensTable)
    .set({ compromisSigneLe: new Date() })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}

export async function annulerCompromis(id: string): Promise<Bien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(biensTable)
    .set({ compromisSigneLe: null })
    .where(eq(biensTable.id, id))
    .returning();
  return ligne ? ligneVersBien(ligne) : undefined;
}
