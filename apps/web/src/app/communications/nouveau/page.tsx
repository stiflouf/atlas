import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import BrouillonEmailFormulaire from "@/components/communications/BrouillonEmailFormulaire";
import { getTacheById, listerTaches } from "@/lib/tacheRepository";
import { getBienById, listerBiens } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { listerVisitesPourAcquereur } from "@/lib/visiteRepository";
import { listerComptesRendus } from "@/lib/compteRenduVisiteRepository";
import { listerOffresPourAcquereur } from "@/lib/offreRepository";
import { listerCompromisPourAcquereur } from "@/lib/compromisRepository";
import { evaluerCompatibiliteAcquereur } from "@/lib/compatibilite/orchestration";
import { chargerContexteOpportunites } from "@/lib/opportunites/contexte";
import { detecterOpportunites } from "@/lib/opportunites/moteur";
import { construireRepriseContactAcquereur } from "@/lib/communications/repriseContactAcquereur";
import { deriverStatutTache } from "@/types/tache";
import { listerDocumentsPourBien } from "@/lib/documentBienRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";
import { getProspectVendeurParBien } from "@/lib/prospectVendeurRepository";
import { calculerChecklistDossier } from "@/lib/documents/checklistDossier";
import {
  assemblerFaits,
  LABEL_INTENTION_COMMUNICATION,
  type DestinataireCandidat,
  type FaitsCommunication,
  type IntentionCommunication,
} from "@/lib/communications/contexteCommunication";
import {
  determinerIntentionParDefaut,
  resoudreContexteCommunicationDepuisTache,
} from "@/lib/communications/resoudreContexteCommunicationDepuisTache";
import {
  resoudreDestinatairesDepuisDocument,
  versCandidatAcquereur,
} from "@/lib/communications/destinataireCommunication";
import { chargerCapacitesGoogle } from "@/lib/google/capacites";

type PageProps = {
  searchParams: Promise<{
    tacheId?: string;
    bienId?: string;
    acquereurId?: string;
    exigenceCode?: string;
    notaire?: string;
    candidat?: string;
  }>;
};

type ResultatContexte = {
  titre: string;
  // Fonction plutôt qu'une valeur figée : pour une cible `bien` ambiguë, l'intention dépend du
  // TYPE du candidat finalement retenu (vendeur ou acquéreur), connu seulement une fois le choix
  // humain fait — jamais fixée avant.
  determinerIntention: (typeCandidatChoisi: DestinataireCandidat["type"] | undefined) => IntentionCommunication;
  candidats: DestinataireCandidat[];
  faits: Omit<FaitsCommunication, "destinataireNom" | "destinatairePrenom">;
  retourHref: string;
  // Optionnel : uniquement renseigné quand le bien est directement connu sans lookup
  // supplémentaire (jamais recherché exprès pour ce seul besoin) — contexte pour l'écran d'envoi
  // Gmail (ADR-031-bis, ex. redirection après clôture de tâche).
  bienId?: string;
  tacheId?: string;
};

function trouverCandidatChoisi(candidats: DestinataireCandidat[], valeur: string | undefined) {
  if (!valeur) return undefined;
  const [type, id] = valeur.split(":");
  return candidats.find((c) => c.type === type && c.id === id);
}

async function chargerContexteDossier(bienId: string) {
  const bien = await getBienById(bienId);
  if (!bien) return undefined;
  const documents = await listerDocumentsPourBien(bien.id);
  const compromis = await listerCompromisPourBien(bien.id);
  const compromisActuel =
    compromis.find((c) => c.statut === "en_cours") ??
    [...compromis].sort((a, b) => (a.dateSignature < b.dateSignature ? 1 : -1))[0];
  const prospectVendeurOrigine = await getProspectVendeurParBien(bien.id);
  return { bien, documents, compromisActuel, prospectVendeurOrigine };
}

async function resoudreDepuisTache(tacheId: string): Promise<ResultatContexte | undefined> {
  const tache = await getTacheById(tacheId);
  if (!tache) return undefined;
  const { cibleType, candidats, faits } = await resoudreContexteCommunicationDepuisTache(tache);
  return {
    titre: tache.titre,
    determinerIntention: (typeCandidatChoisi) =>
      determinerIntentionParDefaut(cibleType, typeCandidatChoisi, faits, tache.origineCode),
    candidats,
    faits,
    retourHref: "/",
    bienId: cibleType === "bien" ? tache.bienId : undefined,
    tacheId: tache.id,
  };
}

async function resoudreDepuisConstat(bienId: string, exigenceCode: string): Promise<ResultatContexte | undefined> {
  const contexte = await chargerContexteDossier(bienId);
  if (!contexte) return undefined;
  const { bien, documents, compromisActuel, prospectVendeurOrigine } = contexte;
  const checklist = calculerChecklistDossier({ bien, compromisActuel, prospectVendeurOrigine }, documents);
  const exigence = checklist.exigences.find((e) => e.code === exigenceCode);
  if (!exigence || (exigence.etat !== "manquant" && exigence.etat !== "a_verifier" && exigence.etat !== "perime")) {
    return undefined;
  }

  const candidats = await resoudreDestinatairesDepuisDocument(exigence.document, bienId);
  const intentionFixe: IntentionCommunication =
    exigence.etat === "manquant" ? "demande_document_manquant" : "relance_piece_a_verifier";
  return {
    titre: `${bien.titre} — ${exigence.label}`,
    determinerIntention: () => intentionFixe,
    candidats,
    faits: { bienAdresse: bien.adresse, documentLabel: exigence.label },
    retourHref: `/biens/${bienId}`,
    bienId,
  };
}

// VALUE-04 — entrée dédiée depuis une fiche acquéreur, sans tâche. Le paramètre d'URL n'est JAMAIS
// une autorisation : la situation est entièrement rejouée côté serveur (visites, comptes rendus,
// offres, compromis, compatibilités canoniques, opportunités VALUE-01) et la page n'existe que si
// la projection communicationnelle produit réellement une reprise sans tâche. Un lien forgé à la
// main ne peut donc pas produire un message présentant un bien comme compatible quand il ne l'est
// pas, ni relancer un acquéreur qui a décliné.
//
// Aucune tâche n'est créée pour obtenir un tacheId : `envois_email.tache_id` est nullable et toute
// la chaîne d'envoi (ADR-031-bis) l'accepte déjà absent — rien n'a été modifié côté Gmail.
async function resoudreDepuisAcquereur(acquereurId: string): Promise<ResultatContexte | undefined> {
  const acquereur = await getClientById(acquereurId);
  if (!acquereur || acquereur.archiveLe) return undefined;

  const [visites, tousComptesRendus, offres, compromis, compatibilites, biens] = await Promise.all([
    listerVisitesPourAcquereur(acquereur.id),
    listerComptesRendus(),
    listerOffresPourAcquereur(acquereur.id),
    listerCompromisPourAcquereur(acquereur.id),
    evaluerCompatibiliteAcquereur(acquereur.id),
    listerBiens(),
  ]);
  const tachesActives = (await listerTaches()).filter((t) => deriverStatutTache(t) === "a_faire");
  const opportunites = detecterOpportunites(
    await chargerContexteOpportunites({ biens, acquereurs: [acquereur], tachesActives })
  );

  const reprise = construireRepriseContactAcquereur({
    acquereur,
    visites,
    comptesRendus: tousComptesRendus.filter((cr) => cr.acquereurId === acquereur.id),
    offres,
    compromis,
    compatibilites,
    opportunites,
    tachesActives,
    biens,
  });

  // Une reprise passant par une tâche s'ouvre par `?tacheId=` (chemin le plus fiable, ADR-031) —
  // jamais par cette entrée, qui reconstruirait un contexte moins riche pour la même communication.
  if (!reprise || reprise.tacheId || !reprise.intention || !reprise.faitsPartageables) return undefined;

  return {
    titre: `${acquereur.prenom} ${acquereur.nom}`,
    determinerIntention: () => reprise.intention!,
    candidats: [versCandidatAcquereur(acquereur)],
    // Seuls les faits de la liste blanche entrent ici : le type FaitsPartageablesAcquereur interdit
    // structurellement d'y glisser une note interne ou un montant.
    faits: reprise.faitsPartageables,
    retourHref: `/clients/${acquereur.id}`,
    bienId: reprise.bienId,
  };
}

async function resoudreDepuisNotaire(bienId: string): Promise<ResultatContexte | undefined> {
  const contexte = await chargerContexteDossier(bienId);
  if (!contexte) return undefined;
  const { bien, documents, compromisActuel, prospectVendeurOrigine } = contexte;
  const checklist = calculerChecklistDossier({ bien, compromisActuel, prospectVendeurOrigine }, documents);
  const documentsAObtenir = checklist.exigences.filter((e) => e.etat === "manquant").map((e) => e.label);

  return {
    titre: `${bien.titre} — message notaire`,
    determinerIntention: () => "message_notaire",
    // Aucun contact notaire structuré n'existe (ADR-031, arbitrage) : jamais de destinataire pour
    // ce cas, contenu seul.
    candidats: [],
    faits: { bienAdresse: bien.adresse, documentsAObtenirNotaire: documentsAObtenir },
    retourHref: `/biens/${bienId}/pack-notaire`,
    bienId,
  };
}

export default async function PageNouvelleCommunication({ searchParams }: PageProps) {
  const params = await searchParams;

  let resultat: ResultatContexte | undefined;
  if (params.tacheId) {
    resultat = await resoudreDepuisTache(params.tacheId);
  } else if (params.bienId && params.exigenceCode) {
    resultat = await resoudreDepuisConstat(params.bienId, params.exigenceCode);
  } else if (params.bienId && params.notaire === "1") {
    resultat = await resoudreDepuisNotaire(params.bienId);
  } else if (params.acquereurId) {
    resultat = await resoudreDepuisAcquereur(params.acquereurId);
  }

  if (!resultat) notFound();
  const { titre, determinerIntention, candidats, faits, retourHref, bienId, tacheId } = resultat;
  const { gmailAutorise } = await chargerCapacitesGoogle();

  // Un destinataire déjà choisi (retour du formulaire de choix ci-dessous) prime toujours sur une
  // ambiguïté résiduelle — jamais retranché arbitrairement si le choix explicite du conseiller est
  // présent dans l'URL.
  const candidatChoisi =
    candidats.length === 1 ? candidats[0] : trouverCandidatChoisi(candidats, params.candidat);
  const choixRequis = candidats.length > 1 && !candidatChoisi;
  const intention = determinerIntention(candidatChoisi?.type);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={retourHref}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Retour
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-1">{titre}</h1>
      <p className="text-[14px] text-text-2 mb-6">{LABEL_INTENTION_COMMUNICATION[intention]}</p>

      {choixRequis ? (
        <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[13px] text-text-1 mb-3">
            Plusieurs destinataires sont possibles pour ce dossier — choisissez celui à qui adresser ce message.
          </p>
          <form method="GET" className="flex flex-col gap-2">
            {params.tacheId && <input type="hidden" name="tacheId" value={params.tacheId} />}
            {params.bienId && <input type="hidden" name="bienId" value={params.bienId} />}
            {params.exigenceCode && <input type="hidden" name="exigenceCode" value={params.exigenceCode} />}
            {candidats.map((c) => (
              <label key={`${c.type}:${c.id}`} className="inline-flex items-center gap-2 text-[14px] text-text-1">
                <input type="radio" name="candidat" value={`${c.type}:${c.id}`} required />
                {c.prenom ? `${c.prenom} ${c.nom}` : c.nom}
                <span className="text-[11px] text-text-3">
                  ({c.type === "prospectVendeur" ? "vendeur" : "acquéreur"})
                </span>
              </label>
            ))}
            <button
              type="submit"
              className="self-start mt-2 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg"
            >
              Choisir ce destinataire
            </button>
          </form>
        </div>
      ) : (
        <BrouillonEmailFormulaire
          intention={intention}
          faits={assemblerFaits(candidatChoisi, faits)}
          destinataireEmail={candidatChoisi?.email}
          gmailAutorise={gmailAutorise}
          destinataireCandidatType={candidatChoisi?.type}
          destinataireCandidatId={candidatChoisi?.id}
          tacheId={tacheId}
          bienId={bienId}
        />
      )}
    </div>
  );
}
