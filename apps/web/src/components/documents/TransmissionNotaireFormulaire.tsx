"use client";

import { useActionState, useState } from "react";
import { enregistrerTransmissionDossierNotaireAction, type ResultatActionTransmission } from "@/actions/transmissionDossierNotaire";

const ETAT_INITIAL: ResultatActionTransmission = { statut: "idle" };

type DocumentSelectionnable = { id: string; nom: string };

function valeurDatetimeLocalMaintenant(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ProprietesEcranConfirmation = {
  compromisId: string;
  cleIdempotence: string;
  etudeNom: string;
  destinataireNom: string;
  destinataireEmail: string;
  transmisLe: string;
  documentIds: string[];
  documentsSelectionnesLabels: string[];
  onAnnuler: () => void;
  onNouvelleTentative: () => void;
};

// Monté avec `key={cleIdempotence}` par le parent — une nouvelle tentative après un état terminal
// (échec) régénère la clé côté parent, ce qui remonte ce composant et repart d'un useActionState
// propre (même patron que EcranConfirmationEnvoi, BrouillonEmailFormulaire.tsx).
function EcranConfirmationTransmission({
  compromisId,
  cleIdempotence,
  etudeNom,
  destinataireNom,
  destinataireEmail,
  transmisLe,
  documentIds,
  documentsSelectionnesLabels,
  onAnnuler,
  onNouvelleTentative,
}: ProprietesEcranConfirmation) {
  const [etat, declencher] = useActionState(enregistrerTransmissionDossierNotaireAction, ETAT_INITIAL);

  const champsCaches = (
    <>
      <input type="hidden" name="compromisId" value={compromisId} />
      <input type="hidden" name="cleIdempotence" value={cleIdempotence} />
      <input type="hidden" name="etudeNom" value={etudeNom} />
      <input type="hidden" name="destinataireNom" value={destinataireNom} />
      <input type="hidden" name="destinataireEmail" value={destinataireEmail} />
      <input type="hidden" name="transmisLe" value={transmisLe} />
      {documentIds.map((id) => (
        <input key={id} type="hidden" name="documentIds" value={id} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-3 bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-4">
      {etat.statut === "idle" && (
        <>
          <p className="text-[14px] text-[#0f172a] font-medium">Confirmer l&apos;enregistrement de cette transmission ?</p>
          <div className="text-[13px] text-[#0f172a] flex flex-col gap-1">
            <p>
              <span className="text-[#64748b]">Étude : </span>
              {etudeNom}
            </p>
            {destinataireNom && (
              <p>
                <span className="text-[#64748b]">Interlocuteur : </span>
                {destinataireNom}
              </p>
            )}
            {destinataireEmail && (
              <p>
                <span className="text-[#64748b]">Email : </span>
                {destinataireEmail}
              </p>
            )}
            <p>
              <span className="text-[#64748b]">Documents ({documentsSelectionnesLabels.length}) : </span>
              {documentsSelectionnesLabels.join(", ")}
            </p>
          </div>
          <p className="text-[12px] text-[#94a3b8]">
            Atlas enregistre cette transmission dans le suivi du dossier. Les documents ne sont pas envoyés par Atlas
            à cette étape — assurez-vous de les avoir déjà transmis par votre canal habituel.
          </p>
          <form action={declencher} className="flex items-center gap-2">
            {champsCaches}
            <button
              type="submit"
              className="text-[13px] font-medium text-white bg-[#16a34a] hover:bg-[#15803d] transition-colors px-3.5 py-2 rounded-lg"
            >
              Je confirme avoir transmis cette sélection à l&apos;étude indiquée
            </button>
            <button
              type="button"
              onClick={onAnnuler}
              className="text-[13px] font-medium text-[#64748b] hover:text-[#0f172a] transition-colors px-3.5 py-2"
            >
              Annuler
            </button>
          </form>
        </>
      )}

      {etat.statut === "enregistree" && (
        <p className="text-[14px] font-medium text-[#16a34a]">Transmission enregistrée dans le suivi du dossier.</p>
      )}

      {etat.statut === "deja_enregistree" && (
        <p className="text-[14px] font-medium text-[#16a34a]">Cette transmission était déjà enregistrée.</p>
      )}

      {etat.statut === "echec" && (
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-medium text-[#dc2626]">{etat.message}</p>
          <button
            type="button"
            onClick={onNouvelleTentative}
            className="self-start text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}

// Formulaire volontairement séparé de celui du téléchargement ZIP (ADR-030, inchangé) : sélection
// de documents indépendante, permet un complément ultérieur avec un sous-ensemble différent
// (ADR-049 §25/§40). Jamais un bouton "Envoyer"/"Transmettre" — Atlas ne transporte aucun fichier
// ici, uniquement une déclaration (§2).
export default function TransmissionNotaireFormulaire({
  compromisId,
  selectionProposee,
  documentsDisponibles,
}: {
  compromisId: string;
  selectionProposee: DocumentSelectionnable[];
  documentsDisponibles: DocumentSelectionnable[];
}) {
  const tousLesDocuments = [...selectionProposee, ...documentsDisponibles];
  const [documentIdsChoisis, setDocumentIdsChoisis] = useState<string[]>(selectionProposee.map((d) => d.id));
  const [etudeNom, setEtudeNom] = useState("");
  const [destinataireNom, setDestinataireNom] = useState("");
  const [destinataireEmail, setDestinataireEmail] = useState("");
  const [transmisLe, setTransmisLe] = useState(valeurDatetimeLocalMaintenant);
  const [cleIdempotence, setCleIdempotence] = useState<string | null>(null);

  function basculerDocument(id: string) {
    setDocumentIdsChoisis((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const documentsSelectionnesLabels = tousLesDocuments.filter((d) => documentIdsChoisis.includes(d.id)).map((d) => d.nom);

  return (
    <div className="mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Transmissions notariales</p>

      {cleIdempotence !== null ? (
        <EcranConfirmationTransmission
          key={cleIdempotence}
          compromisId={compromisId}
          cleIdempotence={cleIdempotence}
          etudeNom={etudeNom}
          destinataireNom={destinataireNom}
          destinataireEmail={destinataireEmail}
          transmisLe={transmisLe}
          documentIds={documentIdsChoisis}
          documentsSelectionnesLabels={documentsSelectionnesLabels}
          onAnnuler={() => setCleIdempotence(null)}
          onNouvelleTentative={() => setCleIdempotence(crypto.randomUUID())}
        />
      ) : (
        <div className="flex flex-col gap-3 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[13px] text-[#64748b]">
            Après avoir transmis le pack (ou un sous-ensemble) par votre canal habituel, enregistrez cette
            transmission pour la retrouver dans le suivi du dossier. Atlas n&apos;envoie aucun fichier à cette étape.
          </p>

          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium text-[#64748b]">Documents à déclarer comme transmis</p>
            {tousLesDocuments.map((doc) => (
              <label key={doc.id} className="inline-flex items-center gap-2 text-[14px] text-[#0f172a]">
                <input type="checkbox" checked={documentIdsChoisis.includes(doc.id)} onChange={() => basculerDocument(doc.id)} />
                {doc.nom}
              </label>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#64748b]">Étude notariale</span>
            <input
              value={etudeNom}
              onChange={(e) => setEtudeNom(e.target.value)}
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#64748b]">Interlocuteur (optionnel)</span>
            <input
              value={destinataireNom}
              onChange={(e) => setDestinataireNom(e.target.value)}
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#64748b]">Email (optionnel)</span>
            <input
              type="email"
              value={destinataireEmail}
              onChange={(e) => setDestinataireEmail(e.target.value)}
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#64748b]">Date de transmission</span>
            <input
              type="datetime-local"
              value={transmisLe}
              onChange={(e) => setTransmisLe(e.target.value)}
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </label>

          <button
            type="button"
            disabled={!etudeNom.trim() || documentIdsChoisis.length === 0}
            onClick={() => setCleIdempotence(crypto.randomUUID())}
            className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg disabled:opacity-40"
          >
            Enregistrer la transmission
          </button>
        </div>
      )}
    </div>
  );
}
