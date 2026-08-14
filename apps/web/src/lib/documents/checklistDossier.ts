import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";
import type { DocumentBien, FamilleDocument, TypeDocument } from "@/types/documentBien";
import type { ProspectVendeur } from "@/types/prospectVendeur";

// Contexte minimal du dossier (ADR-029) : dérivé des entités déjà réelles, jamais une nouvelle
// entité "dossier de vente" — voir l'audit ADR-029, point 3. compromisActuel = le compromis
// `en_cours` du bien s'il existe (sinon le plus récent, pour ne pas perdre le contexte d'un
// dossier déjà réalisé/annulé) ; prospectVendeurOrigine = le prospect vendeur ayant converti ce
// bien (bienId), s'il existe.
export type ContexteDossier = {
  bien: Bien;
  compromisActuel?: Compromis;
  prospectVendeurOrigine?: ProspectVendeur;
};

// États de CONTRÔLE d'une exigence — toujours dérivés à la lecture, jamais stockés (ADR-029).
// Distinct de EtatVerificationDocument (src/types/documentBien.ts), qui porte un jugement sur le
// CLASSEMENT d'un document précis, pas sur la satisfaction d'une exigence.
export type EtatControleExigence = "present" | "manquant" | "a_verifier" | "non_applicable" | "perime" | "incoherent";

export const LABEL_ETAT_CONTROLE_EXIGENCE: Record<EtatControleExigence, string> = {
  present: "Présent",
  manquant: "Manquant",
  a_verifier: "À vérifier",
  non_applicable: "Non applicable",
  perime: "Périmé",
  incoherent: "Incohérent",
};

export type ResultatExigence = {
  code: string;
  famille: FamilleDocument;
  label: string;
  etat: EtatControleExigence;
  document?: DocumentBien;
};

export type ChecklistDossier = {
  exigences: ResultatExigence[];
  // PV d'assemblée générale (ADR-029, point 8) : jamais un booléen — un décompte dérivé des
  // documents typeDocument = 'pv_ag' réellement présents, jamais stocké.
  pvAg: { attendus: number; presents: DocumentBien[] };
  // Charge des honoraires (ADR-029, point 13) : un fait de mandat (biens.chargeHonoraires), pas un
  // document — signalé séparément des exigences documentaires ci-dessus.
  honorairesRenseignes: boolean;
};

type ReglExigence = {
  code: string;
  famille: FamilleDocument;
  label: string;
  applicable: (ctx: ContexteDossier) => boolean;
  correspond: (doc: DocumentBien, ctx: ContexteDossier) => boolean;
  // true pour les pièces à durée de vie (diagnostics) : dateFinValidite absente => a_verifier,
  // dateFinValidite dépassée => perime. Aucune durée légale n'est calculée ici (ADR-029, point 9) —
  // uniquement la date saisie manuellement sur le document.
  suiviValidite?: boolean;
};

function correspondBienEtType(typeDocument: TypeDocument) {
  return (doc: DocumentBien, ctx: ContexteDossier) => doc.bienId === ctx.bien.id && doc.typeDocument === typeDocument;
}

const APPLICABLE_TOUJOURS = () => true;
const APPLICABLE_SI_COMPROMIS = (ctx: ContexteDossier) => ctx.compromisActuel !== undefined;
const APPLICABLE_SI_COPROPRIETE = (ctx: ContexteDossier) => !!ctx.bien.nomCopropriete;

// Vocabulaire PRODUIT Atlas (ADR-029) — reprend le retour terrain d'une clerc de notaire pour la
// copropriété, complété d'un minimum pour les autres familles. Ce n'est PAS un référentiel
// juridique : aucune de ces règles n'affirme une obligation légale, aucune source officielle n'a
// été auditée. Chaque règle ne fait que dire "tel type de pièce est PERTINENT dans tel contexte" —
// la présence/absence effective reste toujours dérivée des documents réellement chargés.
const REGLES_CHECKLIST: ReglExigence[] = [
  // Parties
  {
    code: "parties_cni_acquereur",
    famille: "parties",
    label: "Pièce d'identité de l'acquéreur",
    applicable: APPLICABLE_SI_COMPROMIS,
    correspond: (doc, ctx) =>
      doc.bienId === ctx.bien.id && doc.typeDocument === "cni" && doc.acquereurId === ctx.compromisActuel?.acquereurId,
  },
  {
    code: "parties_cni_vendeur",
    famille: "parties",
    label: "Pièce d'identité du vendeur",
    applicable: (ctx) => ctx.prospectVendeurOrigine !== undefined,
    correspond: (doc, ctx) =>
      doc.bienId === ctx.bien.id &&
      doc.typeDocument === "cni" &&
      doc.prospectVendeurId === ctx.prospectVendeurOrigine?.id,
  },
  // Bien
  {
    code: "bien_titre_propriete",
    famille: "bien",
    label: "Titre de propriété",
    applicable: APPLICABLE_TOUJOURS,
    correspond: correspondBienEtType("titre_propriete"),
  },
  // Diagnostics — liste PRODUIT non filtrée par type de bien (ADR-029, point 9 : aucun audit des
  // diagnostics obligatoires par type/localisation n'a été fait, tous restent "pertinents" en V1).
  ...(["dpe", "amiante", "plomb", "electricite", "gaz", "carrez", "termites", "erp", "assainissement"] as const).map(
    (type): ReglExigence => ({
      code: `diagnostic_${type}`,
      famille: "diagnostics",
      label: type.toUpperCase(),
      applicable: APPLICABLE_TOUJOURS,
      correspond: correspondBienEtType(type),
      suiviValidite: true,
    })
  ),
  // Copropriété — applicable uniquement si le bien porte un nom de copropriété renseigné
  // (biens.nomCopropriete), même logique que le retour terrain (bloc non pertinent pour une
  // maison hors copropriété).
  {
    code: "copropriete_reglement",
    famille: "copropriete",
    label: "Règlement de copropriété",
    applicable: APPLICABLE_SI_COPROPRIETE,
    correspond: correspondBienEtType("reglement_copropriete"),
  },
  {
    code: "copropriete_edd",
    famille: "copropriete",
    label: "État descriptif de division (EDD/EDDV)",
    applicable: APPLICABLE_SI_COPROPRIETE,
    correspond: correspondBienEtType("edd"),
  },
  {
    code: "copropriete_pre_etat_date",
    famille: "copropriete",
    label: "Pré-état daté",
    applicable: APPLICABLE_SI_COPROPRIETE,
    correspond: correspondBienEtType("pre_etat_date"),
  },
  {
    code: "copropriete_fiche_synthetique",
    famille: "copropriete",
    label: "Fiche synthétique",
    applicable: APPLICABLE_SI_COPROPRIETE,
    correspond: correspondBienEtType("fiche_synthetique"),
  },
  {
    code: "copropriete_carnet_entretien",
    famille: "copropriete",
    label: "Carnet d'entretien",
    applicable: APPLICABLE_SI_COPROPRIETE,
    correspond: correspondBienEtType("carnet_entretien"),
  },
  {
    code: "copropriete_procedures_syndic",
    famille: "copropriete",
    label: "Procédures en cours du syndic",
    applicable: APPLICABLE_SI_COPROPRIETE,
    correspond: correspondBienEtType("procedures_syndic"),
  },
  // Transaction
  {
    code: "transaction_mandat",
    famille: "transaction",
    label: "Mandat",
    applicable: APPLICABLE_TOUJOURS,
    correspond: correspondBienEtType("mandat"),
  },
  {
    code: "transaction_compromis",
    famille: "transaction",
    label: "Compromis signé",
    applicable: APPLICABLE_SI_COMPROMIS,
    correspond: (doc, ctx) => doc.typeDocument === "compromis" && doc.compromisId === ctx.compromisActuel?.id,
  },
  // Financement
  {
    code: "financement_attestation",
    famille: "financement",
    label: "Attestation de financement de l'acquéreur",
    applicable: APPLICABLE_SI_COMPROMIS,
    correspond: (doc, ctx) =>
      doc.typeDocument === "attestation_financement" && doc.acquereurId === ctx.compromisActuel?.acquereurId,
  },
  // Notaire
  {
    code: "notaire_courrier",
    famille: "notaire",
    label: "Courrier du notaire",
    applicable: APPLICABLE_SI_COMPROMIS,
    correspond: (doc, ctx) => doc.bienId === ctx.bien.id && doc.typeDocument === "courrier_notaire",
  },
];

// Document retenu pour une exigence à candidats multiples : priorité au plus récent (dateDocument,
// à défaut creeLe) jamais rejeté ; si tous les candidats sont rejetés, retourne le plus récent
// rejeté (l'appelant en dérive 'incoherent') — jamais un candidat masqué silencieusement.
function choisirMeilleurDocument(candidats: DocumentBien[]): DocumentBien {
  const cle = (d: DocumentBien) => d.dateDocument ?? d.creeLe;
  const nonRejetes = candidats.filter((d) => d.etatVerification !== "rejete");
  const pool = nonRejetes.length > 0 ? nonRejetes : candidats;
  return [...pool].sort((a, b) => (cle(a) < cle(b) ? 1 : -1))[0];
}

function calculerEtatExigence(regle: ReglExigence, doc: DocumentBien, maintenant: Date): EtatControleExigence {
  if (doc.etatVerification === "rejete") return "incoherent";
  if (regle.suiviValidite) {
    if (!doc.dateFinValidite) return "a_verifier";
    if (new Date(doc.dateFinValidite) < maintenant) return "perime";
  }
  if (doc.etatVerification === "a_verifier") return "a_verifier";
  return "present";
}

// Moteur déterministe (ADR-029) : contexte + règles codées + documents présents => état calculé,
// jamais un score global. Chaque exigence est évaluée indépendamment ; aucune inférence entre
// exigences.
export function calculerChecklistDossier(
  ctx: ContexteDossier,
  documents: DocumentBien[],
  maintenant: Date = new Date()
): ChecklistDossier {
  const exigences: ResultatExigence[] = REGLES_CHECKLIST.map((regle) => {
    if (!regle.applicable(ctx)) {
      return { code: regle.code, famille: regle.famille, label: regle.label, etat: "non_applicable" };
    }
    const candidats = documents.filter((doc) => regle.correspond(doc, ctx));
    if (candidats.length === 0) {
      return { code: regle.code, famille: regle.famille, label: regle.label, etat: "manquant" };
    }
    const document = choisirMeilleurDocument(candidats);
    return {
      code: regle.code,
      famille: regle.famille,
      label: regle.label,
      etat: calculerEtatExigence(regle, document, maintenant),
      document,
    };
  });

  const pvAgPresents = documents
    .filter((doc) => doc.bienId === ctx.bien.id && doc.typeDocument === "pv_ag" && doc.etatVerification !== "rejete")
    .sort((a, b) => ((a.dateDocument ?? a.creeLe) < (b.dateDocument ?? b.creeLe) ? 1 : -1))
    .slice(0, 3);

  return {
    exigences,
    pvAg: { attendus: 3, presents: pvAgPresents },
    honorairesRenseignes: ctx.bien.chargeHonoraires !== undefined,
  };
}
