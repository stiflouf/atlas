import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { exigerContactActif } from "@/lib/contactActif";
import { resoudreContactActif } from "@/lib/contactRepository";
import type { NavigationContactDossier } from "@/types/contact";
import { prospectsVendeurs as prospectsVendeursTable } from "@/db/schema";
import { creerBien, type NouveauBien } from "@/lib/bienRepository";
import { creerMandat } from "@/lib/mandatRepository";
import { emettreEvenementEtPreparerExecutions } from "@/lib/automatisations/evenementMetierRepository";
import {
  filtreIdentiteEffective,
  identiteEffectiveSql,
  joindreContactCanonique,
  resoudreSourcesIdentiteProspectVendeur,
} from "@/lib/identiteContactEffective";
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
// ADR-057 — PROJECTION D'AFFICHAGE de l'identité, pendant vendeur de celle de `clientRepository`.
// Depuis que le Contact fait foi pour un prospect rattaché, ses colonnes `nom`/`prenom`/`email`/
// `telephone` ne sont plus écrites (voir `modifierProspectVendeur`, cible `contact_canonique`) et
// afficheraient une valeur gelée à la création — donc une adresse que les communications
// n'utilisent plus.
//
// La RÈGLE de source n'est pas réécrite ici : `lib/identiteContactEffective.ts` la tient pour les
// deux côtés du CRM. Une personne n'a pas deux identités selon le rôle sous lequel on la regarde.
async function appliquerIdentiteEffective(
  prospects: ProspectVendeur[],
  executeur: Executeur = getDb()
): Promise<ProspectVendeur[]> {
  if (prospects.length === 0) return prospects;
  const sources = await resoudreSourcesIdentiteProspectVendeur(
    prospects.map((p) => p.id),
    executeur
  );
  return prospects.map((prospect) => {
    const source = sources.get(prospect.id);
    // Repli au niveau de l'AGRÉGAT : soit le Contact fournit les quatre champs, soit aucun. `email`
    // et `telephone` sont réécrits même à `undefined` — c'est précisément le cas qui distingue
    // « le Contact n'a pas d'adresse » d'un repli sur celle du dossier.
    if (!source || source.source === "dossier") return prospect;
    return {
      ...prospect,
      nom: source.identite.nom,
      prenom: source.identite.prenom,
      email: source.identite.email,
      telephone: source.identite.telephone,
    };
  });
}

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
  return appliquerIdentiteEffective(tous.filter(predicatVue("en_cours")));
}

export async function listerProspectsVendeursPerdus(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return appliquerIdentiteEffective(tous.filter(predicatVue("perdus")));
}

export async function listerProspectsVendeursConvertis(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return appliquerIdentiteEffective(tous.filter(predicatVue("convertis")));
}

// Réservé aux prospects archivés — orthogonal au statut (un prospect archivé peut être dans
// n'importe quel état, y compris perdu ou converti).
export async function listerProspectsVendeursArchives(): Promise<ProspectVendeur[]> {
  const tous = await listerToutesLesLignes();
  return appliquerIdentiteEffective(tous.filter(predicatVue("archives")));
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
//
// ADR-057 — le filtre `q` porte sur l'identité EFFECTIVE (Contact pour un prospect rattaché,
// instantané sinon), même règle SQL que `rechercherAcquereursPage` : la liste se cherche par ce
// qu'elle affiche. Le filtre par vue, lui, reste en mémoire (statut jamais stocké, voir ci-dessus).
export async function rechercherProspectsVendeurs(params: { q?: string; vue: VueProspectVendeur }): Promise<ProspectVendeur[]> {
  const texte = params.q?.trim();
  const conditionTexte = texte
    ? filtreIdentiteEffective(texte, identiteEffectiveSql(prospectsVendeursTable.contactId, prospectsVendeursTable))
    : undefined;

  const lignes = await joindreContactCanonique(
    getDb().select(getTableColumns(prospectsVendeursTable)).from(prospectsVendeursTable).$dynamic(),
    prospectsVendeursTable.contactId
  )
    .where(conditionTexte)
    .orderBy(desc(prospectsVendeursTable.creeLe), desc(prospectsVendeursTable.id));

  return appliquerIdentiteEffective(lignes.map(ligneVersProspectVendeur).filter(predicatVue(params.vue)));
}

// ADR-055 — pendant vendeur de `getContactCanoniqueDeLAcquereur`, même rationale : le pont vers
// l'identité canonique n'a pas à voyager sur le type que lisent les écrans. `undefined` = ligne
// inexistante OU non rattachée ; dans les deux cas, rien de canonique n'est écrit.
// ADR-059 — même règle que `getNavigationContactDeLAcquereur` : Contact ACTIF final résolu par
// `resoudreContactActif` dans le workspace du dossier, lecture pure, erreur contrôlée sur un pont
// incohérent.
export async function getNavigationContactDuProspectVendeur(
  prospectVendeurId: string,
  executeur: Executeur = getDb()
): Promise<NavigationContactDossier> {
  if (!UUID_REGEX.test(prospectVendeurId)) return {};
  const [ligne] = await executeur
    .select({ contactId: prospectsVendeursTable.contactId, workspaceId: prospectsVendeursTable.workspaceId })
    .from(prospectsVendeursTable)
    .where(eq(prospectsVendeursTable.id, prospectVendeurId))
    .limit(1);
  if (!ligne?.contactId) return {};
  const resolution = await resoudreContactActif(ligne.contactId, ligne.workspaceId, executeur);
  if (resolution.statut !== "actif") {
    throw new Error(`Contact canonique incohérent pour le dossier vendeur ${prospectVendeurId} (${resolution.statut})`);
  }
  return { contactId: ligne.contactId, contactActifId: resolution.contact.id };
}

export async function getContactCanoniqueDuProspectVendeur(
  prospectVendeurId: string,
  executeur: Executeur = getDb()
): Promise<string | undefined> {
  if (!UUID_REGEX.test(prospectVendeurId)) return undefined;
  const [ligne] = await executeur
    .select({ contactId: prospectsVendeursTable.contactId })
    .from(prospectsVendeursTable)
    .where(eq(prospectsVendeursTable.id, prospectVendeurId))
    .limit(1);
  return ligne?.contactId ?? undefined;
}

export async function getProspectVendeurById(id: string): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id)).limit(1);
  if (!ligne) return undefined;
  const [effectif] = await appliquerIdentiteEffective([ligneVersProspectVendeur(ligne)]);
  return effectif;
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
  if (!ligne) return undefined;
  const [effectif] = await appliquerIdentiteEffective([ligneVersProspectVendeur(ligne)]);
  return effectif;
}

// Insertion pure : la validation métier (email/téléphone, etc.) est de la responsabilité de
// l'appelant (Server Action), pas de ce repository.
// ADR-054 — `workspaceId` est un paramètre OBLIGATOIRE, jamais une valeur que ce repository
// choisirait : il vient du contexte authentifié (`exigerWorkspaceCourant()`) ou du contexte
// d'exécution machine (`resoudreWorkspaceExecutionMachine()`). Aucun repli, aucun `?? "default"` —
// la migration 0033 a retiré le DEFAULT SQL précisément pour qu'un oubli échoue immédiatement au
// lieu d'être silencieusement rangé dans le workspace historique.
export async function creerProspectVendeur(
  input: NouveauProspectVendeur,
  workspaceId: string,
  // `executeur` optionnel, même patron que creerBien/creerAcquereur (ADR-019) : permet de créer le
  // prospect dans la même transaction que l'identité canonique qu'il référence (ADR-055).
  executeur: Executeur = getDb()
): Promise<ProspectVendeur> {
  // ADR-059 §10 — même garde que `creerAcquereur` : un `contactId` fourni doit désigner un contact
  // actif de ce workspace, lu SOUS VERROU avant l'insertion. Sans `contactId`, comportement inchangé.
  return executeur.transaction(async (tx) => {
  if (input.contactId) await exigerContactActif(input.contactId, tx, workspaceId);
  const [ligne] = await tx
    .insert(prospectsVendeursTable)
    .values({
      workspaceId,
      contactId: input.contactId ?? null,
      projetVendeurId: input.projetVendeurId ?? null,
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
  });
}

// ADR-057 — OÙ va l'identité de cette modification. Paramètre OBLIGATOIRE, jamais une valeur par
// défaut : se tromper de cible n'échoue pas, ça écrit au mauvais endroit et le produit envoie
// ensuite ses emails à une adresse que plus personne n'affiche. Même discipline que
// `CibleIdentiteAcquereur`, et pour la même raison.
//
//   'dossier'           -> le prospect porte son identité (aucun Contact rattaché)
//   'contact_canonique' -> le Contact la porte ; cet UPDATE n'y touche PAS
export type CibleIdentiteProspectVendeur = "dossier" | "contact_canonique";

export async function modifierProspectVendeur(
  id: string,
  input: NouveauProspectVendeur,
  cibleIdentite: CibleIdentiteProspectVendeur,
  // ADR-054 — le périmètre est vérifié DANS le `WHERE` : un id d'un autre workspace ne correspond à
  // aucune ligne, la fonction rend `undefined`, et l'appelant en fait un `notFound()`. Ce writer
  // n'avait jusqu'ici ni périmètre ni exécuteur partagé — deux trous relevés par l'audit d'identité.
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProspectVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const colonnesIdentite =
    cibleIdentite === "dossier"
      ? {
          nom: input.nom,
          prenom: input.prenom ?? null,
          email: input.email ?? null,
          telephone: input.telephone ?? null,
        }
      : {};
  const [ligne] = await executeur
    .update(prospectsVendeursTable)
    .set({
      ...colonnesIdentite,
      origineLead: input.origineLead ?? null,
      origineLeadDetail: input.origineLeadDetail ?? null,
      adresseBienPotentiel: input.adresseBienPotentiel ?? null,
      secteurBienPotentiel: input.secteurBienPotentiel ?? null,
      ville: input.ville ?? null,
      codePostal: input.codePostal ?? null,
      typeBien: input.typeBien ?? null,
      modifieLe: new Date(),
    })
    .where(and(eq(prospectsVendeursTable.id, id), eq(prospectsVendeursTable.workspaceId, workspaceId)))
    .returning();
  if (!ligne) return undefined;
  const [effectif] = await appliquerIdentiteEffective([ligneVersProspectVendeur(ligne)], executeur);
  return effectif;
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
  donneesBien: NouveauBien,
  // ADR-054 — le bien créé par la conversion et l'événement `mandat_signe` sont deux écritures de
  // tables racines : leur périmètre vient de l'appelant (Server Action), jamais de ce repository.
  workspaceId: string
): Promise<{ prospect: ProspectVendeur; bien: Bien; idsExecutionsATraiter: string[] } | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const existant = await getProspectVendeurById(id);
  if (!existant) return undefined;

  return getDb().transaction(async (tx) => {
    const bien = await creerBien(donneesBien, workspaceId, tx);
    const [ligne] = await tx
      .update(prospectsVendeursTable)
      .set({ mandatSigneLe: new Date(), bienId: bien.id, modifieLe: new Date() })
      .where(eq(prospectsVendeursTable.id, id))
      .returning();

    // ADR-055 §F — le MANDAT canonique, dans la MÊME transaction que le bien et le jalon : un
    // mandat sans bien, ou un bien mandaté sans mandat, seraient tous deux des demi-vérités.
    //
    // Créé pour TOUTE signature, y compris depuis une opportunité antérieure au modèle canonique :
    // qu'un mandat ait été signé sur ce bien à cette date est un fait, que le projet vendeur existe
    // ou non. Dans ce cas `projetVendeurId` reste simplement absent — jamais deviné.
    //
    // `dateDebut` vient de `donneesBien.dateMandat`, la seule date que la signature saisisse. Ni
    // durée, ni type, ni numéro ne sont posés : le formulaire ne les demande pas, et les inventer
    // fabriquerait des clauses contractuelles que personne n'a signées.
    await creerMandat(
      {
        bienId: bien.id,
        // Lu sur la ligne renvoyée par l'UPDATE, pas sur le type métier : le pont canonique est
        // une donnée d'infrastructure, que `ProspectVendeur` n'expose volontairement pas.
        projetVendeurId: ligne.projetVendeurId ?? undefined,
        dateDebut: donneesBien.dateMandat,
      },
      tx
    );

    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: "mandat_signe", prospectVendeurId: id },
      workspaceId,
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

