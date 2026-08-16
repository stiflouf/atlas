import { desc, eq, ilike, or } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { prospectsVendeurs as prospectsVendeursTable } from "@/db/schema";
import { creerBien, type NouveauBien } from "@/lib/bienRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import type { NouveauProspectVendeur, ProspectVendeur } from "@/types/prospectVendeur";
import type { TypeBien } from "@/types/bien";
import type { OrigineLead } from "@/types/origineLead";
import type { MotifPerteProspectVendeur } from "@/types/motifPerteProspectVendeur";
import type { Bien } from "@/types/bien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneProspectVendeur = typeof prospectsVendeursTable.$inferSelect;

// NULL Postgres -> undefined métier, jamais interprété comme false ni comme une valeur par défaut
// — même principe que bienRepository/clientRepository.
function ligneVersProspectVendeur(ligne: LigneProspectVendeur): ProspectVendeur {
  return {
    id: ligne.id,
    nom: ligne.nom,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
    origineLead: (ligne.origineLead as OrigineLead | null) ?? undefined,
    origineLeadDetail: ligne.origineLeadDetail ?? undefined,
    adresseBienPotentiel: ligne.adresseBienPotentiel ?? undefined,
    secteurBienPotentiel: ligne.secteurBienPotentiel ?? undefined,
    ville: ligne.ville ?? undefined,
    codePostal: ligne.codePostal ?? undefined,
    typeBien: (ligne.typeBien as TypeBien | null) ?? undefined,
    qualifieLe: ligne.qualifieLe?.toISOString(),
    estimationProposeeCentimes: ligne.estimationProposeeCentimes ?? undefined,
    estimationProposeeLe: ligne.estimationProposeeLe ?? undefined,
    rdvEstimationPrevuLe: ligne.rdvEstimationPrevuLe?.toISOString(),
    rdvEstimationRealiseLe: ligne.rdvEstimationRealiseLe?.toISOString(),
    mandatProposeLe: ligne.mandatProposeLe?.toISOString(),
    mandatSigneLe: ligne.mandatSigneLe?.toISOString(),
    bienId: ligne.bienId ?? undefined,
    motifPerte: (ligne.motifPerte as MotifPerteProspectVendeur | null) ?? undefined,
    datePerte: ligne.datePerte ?? undefined,
    dernierContactLe: ligne.dernierContactLe?.toISOString(),
    archiveLe: ligne.archiveLe?.toISOString(),
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

async function listerToutesLesLignes(): Promise<ProspectVendeur[]> {
  const lignes = await getDb().select().from(prospectsVendeursTable);
  return lignes.map(ligneVersProspectVendeur);
}

export type VueProspectVendeur = "en_cours" | "perdus" | "convertis" | "archives";

// Prédicat métier UNIQUE (ADR-048) : factorisé pour que listerProspectsVendeurs*() et la future
// recherche paginée appliquent strictement les mêmes règles actif/perdu/converti/archivé — jamais
// une seconde définition qui pourrait diverger. Le statut n'étant jamais stocké (voir
// deriverStatutProspectVendeur), le filtrage reste en mémoire après lecture, inchangé depuis avant
// cette ADR — seul le point d'appel est désormais partagé plutôt que dupliqué quatre fois.
function predicatVue(vue: VueProspectVendeur): (p: ProspectVendeur) => boolean {
  return (p) => {
    if (vue === "archives") return Boolean(p.archiveLe);
    if (p.archiveLe) return false;
    const statut = deriverStatutProspectVendeur(p);
    if (vue === "perdus") return statut === "perdu";
    if (vue === "convertis") return statut === "mandat_signe";
    return statut !== "perdu" && statut !== "mandat_signe"; // en_cours
  };
}

// Vue par défaut : non archivés, statut en cours (ni perdu, ni déjà converti).
export async function listerProspectsVendeurs(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return tous.filter(predicatVue("en_cours"));
}

export async function listerProspectsVendeursPerdus(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return tous.filter(predicatVue("perdus"));
}

export async function listerProspectsVendeursConvertis(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return tous.filter(predicatVue("convertis"));
}

// Réservé aux prospects archivés — orthogonal au statut (un prospect archivé peut être dans
// n'importe quel état, y compris perdu ou converti).
export async function listerProspectsVendeursArchives(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return tous.filter(predicatVue("archives"));
}

// ADR-048 — recherche serveur (ILIKE nom/prénom) + ordre déterministe (`creeLe DESC, id DESC`,
// voir bienRepository/clientRepository pour la justification), réservée à la page
// /prospects-vendeurs. Le filtrage par vue réutilise EXACTEMENT predicatVue() ci-dessus — jamais
// une seconde définition métier.
//
// Ne pagine PAS elle-même (contrairement à rechercherBiensPage()/rechercherAcquereursPage()) :
// la page /prospects-vendeurs trie déjà la vue "en_cours" par échéance de tâche la plus proche
// (comparerParEcheance, dépendant de tacheRepository — une donnée que ce repository n'a
// délibérément pas vocation à connaître, ADR-007) avant de paginer. Retourner ici la liste complète
// déjà filtrée/recherchée/ordonnée permet à la page d'appliquer ce tri métier existant sur
// l'ensemble des résultats avant de découper la page demandée, sans le dupliquer ni le déplacer.
// Volume réaliste mono-conseiller (quelques centaines de lignes) : sans coût mesurable.
export async function rechercherProspectsVendeurs(params: { q?: string; vue: VueProspectVendeur }): Promise<ProspectVendeur[]> {
  const texte = params.q?.trim();
  const conditionTexte = texte
    ? or(ilike(prospectsVendeursTable.nom, `%${texte}%`), ilike(prospectsVendeursTable.prenom, `%${texte}%`))
    : undefined;

  const lignes = await getDb()
    .select()
    .from(prospectsVendeursTable)
    .where(conditionTexte)
    .orderBy(desc(prospectsVendeursTable.creeLe), desc(prospectsVendeursTable.id));

  return lignes.map(ligneVersProspectVendeur).filter(predicatVue(params.vue));
}

export async function getProspectVendeurById(id: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id)).limit(1);
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Le prospect vendeur ayant converti ce bien, s'il existe (ADR-029) — bienId porte une contrainte
// UNIQUE (ADR-027) : au plus une ligne. Utilisé pour rattacher un document (ex. CNI vendeur) au
// vendeur d'origine depuis la fiche bien, et par le moteur de checklist
// (src/lib/documents/checklistDossier.ts).
export async function getProspectVendeurParBien(bienId: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(bienId)) return undefined;
  const [ligne] = await getDb()
    .select()
    .from(prospectsVendeursTable)
    .where(eq(prospectsVendeursTable.bienId, bienId))
    .limit(1);
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Insertion pure : la validation métier (email/téléphone, etc.) est de la responsabilité de
// l'appelant (Server Action), pas de ce repository.
export async function creerProspectVendeur(input: NouveauProspectVendeur): Promise<ProspectVendeur> {
  const [ligne] = await getDb()
    .insert(prospectsVendeursTable)
    .values({
      nom: input.nom,
      prenom: input.prenom ?? null,
      email: input.email ?? null,
      telephone: input.telephone ?? null,
      origineLead: input.origineLead ?? null,
      origineLeadDetail: input.origineLeadDetail ?? null,
      adresseBienPotentiel: input.adresseBienPotentiel ?? null,
      secteurBienPotentiel: input.secteurBienPotentiel ?? null,
      ville: input.ville ?? null,
      codePostal: input.codePostal ?? null,
      typeBien: input.typeBien ?? null,
    })
    .returning();
  return ligneVersProspectVendeur(ligne);
}

export async function modifierProspectVendeur(
  id: string,
  input: NouveauProspectVendeur
): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({
      nom: input.nom,
      prenom: input.prenom ?? null,
      email: input.email ?? null,
      telephone: input.telephone ?? null,
      origineLead: input.origineLead ?? null,
      origineLeadDetail: input.origineLeadDetail ?? null,
      adresseBienPotentiel: input.adresseBienPotentiel ?? null,
      secteurBienPotentiel: input.secteurBienPotentiel ?? null,
      ville: input.ville ?? null,
      codePostal: input.codePostal ?? null,
      typeBien: input.typeBien ?? null,
      modifieLe: new Date(),
    })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Jalons de pipeline (ADR-027) : écriture pure, aucune garde métier interne (pas perdu, pas déjà
// signé) — portée par la Server Action, même séparation que bienRepository/offreRepository.
// Ne touchent JAMAIS dernier_contact_le : bookkeeping interne, pas nécessairement une interaction
// vécue à cet instant (voir marquerRdvEstimationRealiseProspectVendeur pour la seule exception
// de jalon qui en est une).
export async function qualifierProspectVendeur(id: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ qualifieLe: new Date(), modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// estimationProposeeCentimes/estimationProposeeLe posés atomiquement, même principe que
// offres.dateDecision/motifPerte (ADR-020).
export async function enregistrerEstimationProspectVendeur(
  id: string,
  estimationProposeeCentimes: number,
  estimationProposeeLe: string
): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ estimationProposeeCentimes, estimationProposeeLe, modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Planifié uniquement — ne fait jamais avancer le statut ni dernier_contact_le (ADR-027,
// correction n° 3).
export async function planifierRdvEstimationProspectVendeur(
  id: string,
  rdvEstimationPrevuLe: Date
): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ rdvEstimationPrevuLe, modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Un rendez-vous tenu est par nature une vraie interaction (ADR-027, correction n° 4) : seule
// écriture de jalon de pipeline qui met aussi à jour dernier_contact_le, dans la même UPDATE.
// `executeur` optionnel (ADR-032) : permet à l'appelant d'émettre l'événement métier
// `rdv_estimation_realise` dans la même transaction — l'appelant reste seul responsable de ne
// l'émettre que sur une vraie transition (valeur absente avant cet appel), ce repository continue
// d'autoriser une correction de date sans garde (comportement inchangé).
export async function marquerRdvEstimationRealiseProspectVendeur(
  id: string,
  rdvEstimationRealiseLe: Date,
  executeur: Executeur = getDb()
): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(prospectsVendeursTable)
    .set({ rdvEstimationRealiseLe, dernierContactLe: new Date(), modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

export async function proposerMandatProspectVendeur(id: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ mandatProposeLe: new Date(), modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Conversion en bien (ADR-027, correction n° 6) : une seule transaction — crée le bien (aucun
// champ obligatoire de `biens` n'est jamais fabriqué ici, `donneesBien` doit déjà porter tout ce
// que la Server Action a validé comme explicitement fourni par l'utilisateur) et pose
// mandatSigneLe + bienId dans le même geste. bienId porte une contrainte UNIQUE (schema.ts) : une
// opportunité par bien, et un bien ne peut être le résultat que d'une seule conversion — une
// violation de cette contrainte fait échouer la transaction dans son ensemble (rollback complet,
// aucun bien orphelin créé).
// `idsExecutionsATraiter` (ADR-032) : l'événement métier `mandat_signe` est émis dans CETTE MÊME
// transaction (jamais après coup) — le statut "déjà signé" est déjà exclu en amont par
// `chargerProspectPourJalon` (Server Action), pas besoin d'une garde de transition supplémentaire
// ici, contrairement à `marquerRdvEstimationRealiseProspectVendeur` qui autorise une correction.
export async function signerMandatProspectVendeur(
  id: string,
  donneesBien: NouveauBien
): Promise<{ prospect: ProspectVendeur; bien: Bien; idsExecutionsATraiter: string[] } | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const existant = await getProspectVendeurById(id);
  if (!existant) return undefined;

  return getDb().transaction(async (tx) => {
    const bien = await creerBien(donneesBien, tx);
    const [ligne] = await tx
      .update(prospectsVendeursTable)
      .set({ mandatSigneLe: new Date(), bienId: bien.id, modifieLe: new Date() })
      .where(eq(prospectsVendeursTable.id, id))
      .returning();
    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "mandat_signe", prospectVendeurId: id },
      tx
    );
    return { prospect: ligneVersProspectVendeur(ligne), bien, idsExecutionsATraiter };
  });
}

// motifPerte/datePerte posés atomiquement, même principe que compromis.motifAnnulation/
// dateAnnulation (ADR-020).
export async function marquerProspectVendeurPerdu(
  id: string,
  motifPerte: MotifPerteProspectVendeur,
  datePerte: string
): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ motifPerte, datePerte, modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

// Gestion administrative de la fiche (ADR-012/ADR-027, correction n° 5) — jamais un résultat
// commercial, orthogonal au statut dérivé.
export async function archiverProspectVendeur(id: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ archiveLe: new Date(), modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

export async function desarchiverProspectVendeur(id: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(prospectsVendeursTable)
    .set({ archiveLe: null, modifieLe: new Date() })
    .where(eq(prospectsVendeursTable.id, id))
    .returning();
  return ligne ? ligneVersProspectVendeur(ligne) : undefined;
}

