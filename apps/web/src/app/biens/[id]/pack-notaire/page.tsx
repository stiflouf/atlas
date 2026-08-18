import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  LABEL_ETAT_PREPARATION_PACK,
  LABEL_SEVERITE_PACK_NOTAIRE,
  calculerPackNotaire,
  chargerContextePackNotaire,
  type SeveritePackNotaire,
} from "@/lib/documents/packNotaire";
import { LABEL_ETAT_VERIFICATION_DOCUMENT } from "@/types/documentBien";
import TransmissionNotaireFormulaire from "@/components/documents/TransmissionNotaireFormulaire";

type PageProps = { params: Promise<{ id: string }> };

const ORDRE_SEVERITES: SeveritePackNotaire[] = ["bloquant_technique", "a_obtenir", "a_verifier", "information"];

// Déjà correct avant la passe design RC2 (a_obtenir/a_verifier en warning, jamais en danger) —
// migré ici vers les tokens existants par cohérence (chantier E), sémantique inchangée.
const COULEUR_SEVERITE: Record<SeveritePackNotaire, string> = {
  bloquant_technique: "text-danger",
  a_obtenir: "text-warning",
  a_verifier: "text-warning",
  information: "text-text-3",
};

export default async function PageDossierNotaire({ params }: PageProps) {
  const { id } = await params;
  const contexte = await chargerContextePackNotaire(id);
  if (!contexte) notFound();
  const { ctx, documents } = contexte;
  const { bien, compromisActuel } = ctx;
  const pack = calculerPackNotaire(ctx, documents);

  const raisonExclusion = new Map<string, string>();
  for (const c of pack.constats) {
    if (c.severite === "bloquant_technique" && c.documentId && !raisonExclusion.has(c.documentId)) {
      raisonExclusion.set(c.documentId, c.message);
    }
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/biens/${bien.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {bien.titre}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-1">Dossier notaire</h1>
      <p className="text-[14px] text-[#64748b] mb-3">
        {bien.titre} — {bien.adresse}, {bien.codePostal} {bien.ville}
      </p>
      <Link
        href={`/communications/nouveau?bienId=${bien.id}&notaire=1`}
        className="text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors mb-6 inline-block"
      >
        Préparer un message pour le notaire →
      </Link>

      <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-1">
          État de préparation Atlas
        </p>
        <p className="text-[16px] font-medium text-[#0f172a]">{LABEL_ETAT_PREPARATION_PACK[pack.etatPreparation]}</p>
        {pack.etatPreparation === "preparation_atlas_complete" && (
          <p className="text-[12px] text-[#94a3b8] mt-1">
            Signifie uniquement qu'aucun constat n'est détecté par les contrôles Atlas actuellement implémentés —
            pas une garantie de conformité légale ni d'acceptation par le notaire.
          </p>
        )}
      </div>

      {ORDRE_SEVERITES.map((severite) => {
        const constats = pack.constats.filter((c) => c.severite === severite);
        if (constats.length === 0) return null;
        return (
          <div key={severite} className="mb-4">
            <p className={`text-[12px] font-semibold uppercase tracking-wider mb-1.5 ${COULEUR_SEVERITE[severite]}`}>
              {LABEL_SEVERITE_PACK_NOTAIRE[severite]}
            </p>
            <ul className="flex flex-col gap-1">
              {constats.map((c) => (
                <li key={c.code} className="text-[14px] text-[#0f172a]">
                  {c.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
          Documents prêts : {pack.selectionProposee.length} proposés automatiquement
          {pack.documentsDisponibles.length > 0 && ` — ${pack.documentsDisponibles.length} disponibles pour ajout manuel`}
        </p>

        {!compromisActuel ? (
          <p className="text-[13px] text-[#94a3b8] bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-3">
            Contexte transactionnel incomplet — aucun compromis en cours pour ce bien, le téléchargement du pack
            est indisponible.
          </p>
        ) : (
          <form
            method="POST"
            action={`/api/biens/${bien.id}/pack-notaire`}
            className="flex flex-col gap-2 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4"
          >
            {pack.selectionProposee.map((doc) => (
              <label key={doc.id} className="inline-flex items-center gap-2 text-[14px] text-[#0f172a]">
                <input type="checkbox" name="documentIds" value={doc.id} defaultChecked />
                {doc.nom}
                <span className="text-[11px] text-[#94a3b8]">— proposé</span>
              </label>
            ))}
            {pack.documentsDisponibles.map((doc) => (
              <label key={doc.id} className="inline-flex items-center gap-2 text-[14px] text-[#0f172a]">
                <input type="checkbox" name="documentIds" value={doc.id} />
                {doc.nom}
                <span className="text-[11px] text-[#94a3b8]">
                  — {LABEL_ETAT_VERIFICATION_DOCUMENT[doc.etatVerification]}
                </span>
              </label>
            ))}
            <button
              type="submit"
              className="self-start mt-2 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
            >
              Télécharger le pack (ZIP)
            </button>
          </form>
        )}
      </div>

      {compromisActuel && (
        <TransmissionNotaireFormulaire
          compromisId={compromisActuel.id}
          selectionProposee={pack.selectionProposee.map((d) => ({ id: d.id, nom: d.nom }))}
          documentsDisponibles={pack.documentsDisponibles.map((d) => ({ id: d.id, nom: d.nom }))}
        />
      )}

      {pack.documentsInterdits.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
            Documents exclus de ce pack
          </p>
          <ul className="flex flex-col gap-1">
            {pack.documentsInterdits.map((doc) => (
              <li key={doc.id} className="text-[13px] text-[#94a3b8]">
                <span className="text-[#0f172a]">{doc.nom}</span> — {raisonExclusion.get(doc.id) ?? "exclu"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
