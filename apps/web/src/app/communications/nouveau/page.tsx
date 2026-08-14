import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import BrouillonEmailFormulaire from "@/components/communications/BrouillonEmailFormulaire";
import { getTacheById } from "@/lib/tacheRepository";
import { getBienById } from "@/lib/bienRepository";
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
import { resoudreDestinatairesDepuisDocument } from "@/lib/communications/destinataireCommunication";
import { chargerCapacitesGoogle } from "@/lib/google/capacites";

type PageProps = {
  searchParams: Promise<{ tacheId?: string; bienId?: string; exigenceCode?: string; notaire?: string; candidat?: string }>;
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
    determinerIntention: (typeCandidatChoisi) => determinerIntentionParDefaut(cibleType, typeCandidatChoisi, faits),
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
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Retour
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-1">{titre}</h1>
      <p className="text-[14px] text-[#64748b] mb-6">{LABEL_INTENTION_COMMUNICATION[intention]}</p>

      {choixRequis ? (
        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[13px] text-[#0f172a] mb-3">
            Plusieurs destinataires sont possibles pour ce dossier — choisissez celui à qui adresser ce message.
          </p>
          <form method="GET" className="flex flex-col gap-2">
            {params.tacheId && <input type="hidden" name="tacheId" value={params.tacheId} />}
            {params.bienId && <input type="hidden" name="bienId" value={params.bienId} />}
            {params.exigenceCode && <input type="hidden" name="exigenceCode" value={params.exigenceCode} />}
            {candidats.map((c) => (
              <label key={`${c.type}:${c.id}`} className="inline-flex items-center gap-2 text-[14px] text-[#0f172a]">
                <input type="radio" name="candidat" value={`${c.type}:${c.id}`} required />
                {c.prenom ? `${c.prenom} ${c.nom}` : c.nom}
                <span className="text-[11px] text-[#94a3b8]">
                  ({c.type === "prospectVendeur" ? "vendeur" : "acquéreur"})
                </span>
              </label>
            ))}
            <button
              type="submit"
              className="self-start mt-2 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
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
