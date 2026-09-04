import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import BrouillonEmailFormulaire from "@/components/communications/BrouillonEmailFormulaire";
import ReperesPourEchange from "@/components/communications/ReperesPourEchange";
import {
  assemblerFaits,
  LABEL_INTENTION_COMMUNICATION,
} from "@/lib/communications/contexteCommunication";
import {
  resoudreContexteEcranCommunication,
  trouverCandidatChoisi,
  type ParametresEcranCommunication,
} from "@/lib/communications/contexteEcranCommunication";
import { redactionAssisteeDisponible } from "@/lib/redaction/redacteur";
import { selectionnerReperesPourCommunication } from "@/lib/relations/politiqueReperesCommunication";
import { listerReperesRelationnelsAcquereur } from "@/lib/repereRelationnelRepository";
import { chargerCapacitesGoogle } from "@/lib/google/capacites";

type PageProps = { searchParams: Promise<ParametresEcranCommunication> };

export default async function PageNouvelleCommunication({ searchParams }: PageProps) {
  const params = await searchParams;

  const resultat = await resoudreContexteEcranCommunication(params);
  if (!resultat) notFound();
  const { titre, determinerIntention, candidats, faits, retourHref, bienId, tacheId } = resultat;
  const { gmailAutorise } = await chargerCapacitesGoogle();
  // VALUE-05 — n'expose qu'un booléen : jamais l'URL du fournisseur, jamais le modèle, jamais la clé.
  const redactionDisponible = redactionAssisteeDisponible();

  // Un destinataire déjà choisi (retour du formulaire de choix ci-dessous) prime toujours sur une
  // ambiguïté résiduelle — jamais retranché arbitrairement si le choix explicite du conseiller est
  // présent dans l'URL.
  const candidatChoisi =
    candidats.length === 1 ? candidats[0] : trouverCandidatChoisi(candidats, params.candidat);
  const choixRequis = candidats.length > 1 && !candidatChoisi;
  const intention = determinerIntention(candidatChoisi?.type);

  // VALUE-07B (ADR-053) — repères du SEUL acquéreur réellement résolu comme destinataire par le
  // contexte serveur ci-dessus : jamais un acquéreur deviné depuis l'email, le nom ou le contenu
  // du message, jamais un chargement global. Ils alimentent uniquement le bloc d'affichage
  // ci-dessous — ni `assemblerFaits`, ni le formulaire de rédaction, ni la reformulation.
  const reperesDestinataire =
    candidatChoisi?.type === "acquereur" ? await listerReperesRelationnelsAcquereur(candidatChoisi.id) : [];
  const { reperesAffichables, presencePreferenceContact } = selectionnerReperesPourCommunication(
    candidatChoisi,
    reperesDestinataire
  );

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

      <ReperesPourEchange reperes={reperesAffichables} presencePreferenceContact={presencePreferenceContact} />

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
          redactionDisponible={redactionDisponible}
          parametresEcran={{
            tacheId: params.tacheId,
            bienId: params.bienId,
            acquereurId: params.acquereurId,
            exigenceCode: params.exigenceCode,
            notaire: params.notaire,
            candidat: params.candidat,
          }}
        />
      )}
    </div>
  );
}
