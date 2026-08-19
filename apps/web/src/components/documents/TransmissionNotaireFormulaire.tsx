"use client";

import { useActionState, useState } from "react";
import { Scale } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import { PRODUCT_NAME } from "@/lib/branding";
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
    <div className="flex flex-col gap-3 bg-surface-muted rounded-lg border border-border p-4">
      {etat.statut === "idle" && (
        <>
          <p className="text-[14px] text-text-1 font-medium">Confirmer l&apos;enregistrement de cette transmission ?</p>
          <div className="text-[13px] text-text-1 flex flex-col gap-1">
            <p>
              <span className="text-text-2">Étude : </span>
              {etudeNom}
            </p>
            {destinataireNom && (
              <p>
                <span className="text-text-2">Interlocuteur : </span>
                {destinataireNom}
              </p>
            )}
            {destinataireEmail && (
              <p>
                <span className="text-text-2">Email : </span>
                {destinataireEmail}
              </p>
            )}
            <p>
              <span className="text-text-2">Documents ({documentsSelectionnesLabels.length}) : </span>
              {documentsSelectionnesLabels.join(", ")}
            </p>
          </div>
          <p className="text-[12px] text-text-3">
            {PRODUCT_NAME} enregistre cette transmission dans le suivi du dossier. Les documents ne sont pas envoyés
            par {PRODUCT_NAME} à cette étape — assurez-vous de les avoir déjà transmis par votre canal habituel.
          </p>
          <form action={declencher} className="flex items-center gap-2">
            {champsCaches}
            <button
              type="submit"
              className="text-[13px] font-medium text-white bg-success hover:bg-[#15803d] transition-colors px-3.5 py-2 rounded-lg"
            >
              Je confirme avoir transmis cette sélection à l&apos;étude indiquée
            </button>
            <button
              type="button"
              onClick={onAnnuler}
              className="text-[13px] font-medium text-text-2 hover:text-text-1 transition-colors px-3.5 py-2"
            >
              Annuler
            </button>
          </form>
        </>
      )}

      {etat.statut === "enregistree" && (
        <p className="text-[14px] font-medium text-success">Transmission enregistrée dans le suivi du dossier.</p>
      )}

      {etat.statut === "deja_enregistree" && (
        <p className="text-[14px] font-medium text-success">Cette transmission était déjà enregistrée.</p>
      )}

      {etat.statut === "echec" && (
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-medium text-danger">{etat.message}</p>
          <button
            type="button"
            onClick={onNouvelleTentative}
            className="self-start text-[12px] font-medium text-accent hover:text-accent-hover transition-colors"
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
      <div className="flex items-center gap-2 mb-2">
        <IconTile icon={Scale} tone="navy" size={26} iconSize={13} />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Transmissions notariales</p>
      </div>

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
        <div className="flex flex-col gap-3 bg-surface border border-border rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] p-4">
          <p className="text-[13px] text-text-2">
            Après avoir transmis le pack (ou un sous-ensemble) par votre canal habituel, enregistrez cette
            transmission pour la retrouver dans le suivi du dossier. {PRODUCT_NAME} n&apos;envoie aucun fichier à cette étape.
          </p>

          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium text-text-2">Documents à déclarer comme transmis</p>
            {tousLesDocuments.map((doc) => (
              <label key={doc.id} className="inline-flex items-center gap-2 text-[14px] text-text-1">
                <input type="checkbox" checked={documentIdsChoisis.includes(doc.id)} onChange={() => basculerDocument(doc.id)} />
                {doc.nom}
              </label>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-2">Étude notariale</span>
            <input
              value={etudeNom}
              onChange={(e) => setEtudeNom(e.target.value)}
              className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-2">Interlocuteur (optionnel)</span>
            <input
              value={destinataireNom}
              onChange={(e) => setDestinataireNom(e.target.value)}
              className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-2">Email (optionnel)</span>
            <input
              type="email"
              value={destinataireEmail}
              onChange={(e) => setDestinataireEmail(e.target.value)}
              className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-2">Date de transmission</span>
            <input
              type="datetime-local"
              value={transmisLe}
              onChange={(e) => setTransmisLe(e.target.value)}
              className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </label>

          <button
            type="button"
            disabled={!etudeNom.trim() || documentIdsChoisis.length === 0}
            onClick={() => setCleIdempotence(crypto.randomUUID())}
            className="self-start text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg disabled:opacity-40"
          >
            Enregistrer la transmission
          </button>
        </div>
      )}
    </div>
  );
}
