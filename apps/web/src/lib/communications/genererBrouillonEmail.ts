import type { BrouillonEmail, FaitsCommunication, IntentionCommunication, TonMessage } from "./contexteCommunication";

// Couche 1 (ADR-031) : contenu métier structuré déterministe, fonctionne sans aucun LLM (couche 2
// explicitement différée hors périmètre). Chaque paragraphe est conditionné uniquement sur la
// PRÉSENCE d'un fait déjà structuré — jamais une donnée inventée, jamais le contenu d'un document
// (seul son nom de type est mentionné, ex. "Pré-état daté").

function formatMontant(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    centimes
  );
}

const FORMULE_FINALE: Record<TonMessage, string> = {
  professionnel: "Cordialement,",
  cordial: "Bien à vous,",
  court: "Merci,",
  relance_douce: "N'hésitez pas à me recontacter si besoin, bonne journée à vous,",
};

function salutation(faits: FaitsCommunication): string {
  const nomAffiche = faits.destinatairePrenom ?? faits.destinataireNom;
  return nomAffiche ? `Bonjour ${nomAffiche},` : "Bonjour,";
}

const OBJET_PAR_INTENTION: Record<IntentionCommunication, (faits: FaitsCommunication) => string> = {
  relance_prospect_vendeur: () => "Suivi de votre projet de vente",
  suivi_rdv_estimation: () => "Suite à notre rendez-vous d'estimation",
  suivi_acquereur: () => "Suivi de votre projet d'acquisition",
  suivi_visite: (f) => `Suite à votre visite${f.bienAdresse ? ` — ${f.bienAdresse}` : ""}`,
  demande_document_manquant: (f) => `Document nécessaire pour votre dossier${f.documentLabel ? ` — ${f.documentLabel}` : ""}`,
  relance_piece_a_verifier: (f) => `Pièce à vérifier pour votre dossier${f.documentLabel ? ` — ${f.documentLabel}` : ""}`,
  message_compromis: (f) => `Votre compromis de vente${f.bienAdresse ? ` — ${f.bienAdresse}` : ""}`,
  message_notaire: (f) => `Dossier de vente${f.bienAdresse ? ` — ${f.bienAdresse}` : ""}`,
};

type ConstructeurParagraphes = (faits: FaitsCommunication, ton: TonMessage) => (string | undefined)[];

const PARAGRAPHES_PAR_INTENTION: Record<IntentionCommunication, ConstructeurParagraphes> = {
  relance_prospect_vendeur: (f, ton) => {
    const lieu = f.bienAdresse ? ` pour le bien situé ${f.bienAdresse}` : "";
    if (ton === "court") return [`Je reviens vers vous concernant votre projet de vente${lieu}.`];
    return [
      `Je me permets de revenir vers vous concernant votre projet de vente${lieu}.`,
      f.tacheContexte ?? "Auriez-vous un moment pour échanger sur la suite ?",
    ];
  },

  suivi_rdv_estimation: (f, ton) => {
    const date = f.dateRdvEstimation ? ` du ${f.dateRdvEstimation}` : "";
    if (ton === "court") return [`Suite à notre rendez-vous d'estimation${date}, je fais le point avec vous.`];
    return [
      `Suite à notre rendez-vous d'estimation${date}, je souhaitais faire le point avec vous.`,
      f.tacheContexte ?? "N'hésitez pas à me faire part de vos questions.",
    ];
  },

  suivi_acquereur: (f, ton) => {
    const lieu = f.bienAdresse ? ` pour le bien situé ${f.bienAdresse}` : "";
    if (ton === "court") return [`Je reviens vers vous concernant votre projet d'acquisition${lieu}.`];
    return [
      `Je me permets de revenir vers vous concernant votre projet d'acquisition${lieu}.`,
      f.tacheContexte ?? "Souhaitez-vous que nous échangions sur la suite à donner ?",
    ];
  },

  suivi_visite: (f, ton) => {
    const date = f.dateVisite ? ` du ${f.dateVisite}` : "";
    const lieu = f.bienAdresse ? ` (${f.bienAdresse})` : "";
    if (ton === "court") return [`Suite à votre visite${date}${lieu}, quel est votre ressenti ?`];
    return [
      `Suite à votre visite${date}${lieu}, je souhaitais avoir votre retour.`,
      f.interetVisite ? `Nous avions noté à l'issue de la visite : ${f.interetVisite}.` : undefined,
      f.tacheContexte,
    ];
  },

  demande_document_manquant: (f, ton) => {
    const lieu = f.bienAdresse ? ` concernant le bien situé ${f.bienAdresse}` : "";
    const piece = f.documentLabel ?? "une pièce de votre dossier";
    if (ton === "court") return [`Il nous manque encore : ${piece}. Pourriez-vous nous la transmettre ?`];
    return [
      `Pour poursuivre votre dossier${lieu}, il nous manque la pièce suivante : ${piece}.`,
      "Pourriez-vous nous la transmettre dès que possible ?",
    ];
  },

  relance_piece_a_verifier: (f, ton) => {
    const lieu = f.bienAdresse ? ` pour le bien situé ${f.bienAdresse}` : "";
    const piece = f.documentLabel ?? "une pièce de votre dossier";
    if (ton === "court") return [`Merci de nous confirmer ou nous transmettre à jour : ${piece}.`];
    return [
      `Concernant votre dossier${lieu}, nous devons vérifier la pièce suivante : ${piece}.`,
      "Pourriez-vous nous la confirmer, ou nous en transmettre une version à jour ?",
    ];
  },

  message_compromis: (f, ton) => {
    const lieu = f.bienAdresse ? ` pour le bien situé ${f.bienAdresse}` : "";
    const prix = f.prixConvenuCompromis ? ` (prix convenu : ${formatMontant(f.prixConvenuCompromis)})` : "";
    if (ton === "court") {
      return [`Je reviens vers vous au sujet du compromis${lieu}${prix}.`];
    }
    return [
      `Je reviens vers vous au sujet du compromis de vente${lieu}${prix}.`,
      f.dateActeCompromis ? `La signature de l'acte est prévue le ${f.dateActeCompromis}.` : undefined,
      f.tacheContexte,
    ];
  },

  message_notaire: (f, ton) => {
    const lieu = f.bienAdresse ? ` du bien situé ${f.bienAdresse}` : "";
    const aObtenir = f.documentsAObtenirNotaire?.length
      ? `Les pièces suivantes restent encore à obtenir de notre côté : ${f.documentsAObtenirNotaire.join(", ")}.`
      : undefined;
    if (ton === "court") return [`Message concernant le dossier de vente${lieu}.`, aObtenir];
    return [`Je vous transmets ce message concernant le dossier de vente${lieu}.`, aObtenir];
  },
};

// Génère un brouillon complet — destinataireEmail est transmis séparément par l'appelant (jamais
// deviné ici), objet/corps sont dérivés uniquement des faits fournis.
export function genererBrouillonEmail(
  intention: IntentionCommunication,
  faits: FaitsCommunication,
  ton: TonMessage,
  destinataireEmail?: string
): BrouillonEmail {
  const paragraphes = PARAGRAPHES_PAR_INTENTION[intention](faits, ton).filter((p): p is string => !!p);
  const corps = [salutation(faits), "", ...paragraphes, "", FORMULE_FINALE[ton]].join("\n");
  return {
    intention,
    ton,
    destinataireEmail,
    objet: OBJET_PAR_INTENTION[intention](faits),
    corps,
  };
}
