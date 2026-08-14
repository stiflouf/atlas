"use client";

import { useActionState, useState } from "react";
import {
  LABEL_TON_MESSAGE,
  type FaitsCommunication,
  type IntentionCommunication,
  type TonMessage,
} from "@/lib/communications/contexteCommunication";
import { genererBrouillonEmail } from "@/lib/communications/genererBrouillonEmail";
import { construireLienMailto } from "@/lib/communications/mailto";
import { envoyerEmailGmailAction, type ResultatActionEnvoiEmail } from "@/actions/envoyerEmailGmail";
import { terminerTacheAction } from "@/actions/terminerTache";

const TONS: TonMessage[] = ["professionnel", "cordial", "court", "relance_douce"];

// Au-delà de cette longueur, un lien mailto: devient peu fiable selon les navigateurs/clients mail
// (limite pratique observée autour de 2000 caractères) — la copie reste alors le seul moyen
// proposé, jamais un échec silencieux (ADR-031, correction n°3).
const LONGUEUR_MAX_MAILTO = 1800;

const ETAT_INITIAL_ENVOI: ResultatActionEnvoiEmail = { statut: "idle" };

type ProprietesEcranConfirmation = {
  destinataireEmail: string;
  objet: string;
  corps: string;
  idempotencyKey: string;
  destinataireCandidatType?: "prospectVendeur" | "acquereur";
  destinataireCandidatId?: string;
  tacheId?: string;
  bienId?: string;
  intention: IntentionCommunication;
  onAnnuler: () => void;
  onNouvelleTentative: () => void;
};

// Monté avec `key={idempotencyKey}` par le parent (BrouillonEmailFormulaire) : une nouvelle
// tentative après un état terminal (incertain/échec) régénère la clé côté parent, ce qui REMONTE
// ce composant — son `useActionState` repart alors d'un état "idle" propre, jamais une résolution
// manuelle d'état interne. C'est la seule façon fiable de garantir qu'une nouvelle soumission
// utilise bien la nouvelle clé (ADR-031-bis : "une nouvelle tentative doit utiliser une nouvelle
// clé d'idempotence").
function EcranConfirmationEnvoi({
  destinataireEmail,
  objet,
  corps,
  idempotencyKey,
  destinataireCandidatType,
  destinataireCandidatId,
  tacheId,
  bienId,
  intention,
  onAnnuler,
  onNouvelleTentative,
}: ProprietesEcranConfirmation) {
  const [etatEnvoi, declencherEnvoi] = useActionState(envoyerEmailGmailAction, ETAT_INITIAL_ENVOI);
  const [tacheTerminee, setTacheTerminee] = useState(false);

  const champsCaches = (
    <>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="destinataireEmail" value={destinataireEmail} />
      <input type="hidden" name="objet" value={objet} />
      <input type="hidden" name="corps" value={corps} />
      <input type="hidden" name="destinataireType" value={destinataireCandidatType ?? ""} />
      <input type="hidden" name="destinataireId" value={destinataireCandidatId ?? ""} />
      <input type="hidden" name="tacheId" value={tacheId ?? ""} />
      <input type="hidden" name="bienId" value={bienId ?? ""} />
      <input type="hidden" name="origineIntention" value={intention} />
    </>
  );

  return (
    <div className="flex flex-col gap-4 bg-[#fafafa] rounded-lg border border-[#f1f5f9] p-4">
      {etatEnvoi.statut === "idle" && (
        <>
          <p className="text-[14px] text-[#0f172a] font-medium">Envoyer cet email à {destinataireEmail} ?</p>
          <div>
            <p className="text-[11px] font-medium text-[#64748b] mb-1">Objet</p>
            <p className="text-[14px] text-[#0f172a]">{objet}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-[#64748b] mb-1">Corps</p>
            <p className="text-[14px] text-[#0f172a] whitespace-pre-wrap">{corps}</p>
          </div>
          <form action={declencherEnvoi} className="flex items-center gap-2">
            {champsCaches}
            <button
              type="submit"
              className="text-[13px] font-medium text-white bg-[#16a34a] hover:bg-[#15803d] transition-colors px-3.5 py-2 rounded-lg"
            >
              Confirmer l&apos;envoi
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

      {(etatEnvoi.statut === "envoye" || etatEnvoi.statut === "deja_envoye") && (
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-medium text-[#16a34a]">
            {etatEnvoi.statut === "envoye" ? "Envoi confirmé par Gmail" : "Email déjà envoyé"}
          </p>
          {tacheId && !tacheTerminee && (
            <form action={terminerTacheAction} onSubmit={() => setTacheTerminee(true)} className="flex items-center gap-2">
              <input type="hidden" name="id" value={tacheId} />
              {bienId && <input type="hidden" name="redirectTo" value={`/biens/${bienId}`} />}
              <button type="submit" className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
                Marquer également la tâche comme terminée
              </button>
            </form>
          )}
        </div>
      )}

      {etatEnvoi.statut === "incertain" && (
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-medium text-[#d97706]">Statut d&apos;envoi incertain</p>
          <p className="text-[13px] text-[#64748b]">
            La confirmation de Google n&apos;a pas pu être obtenue (réseau ou délai dépassé) — vérifiez vos messages
            envoyés dans Gmail avant toute nouvelle tentative. Rien n&apos;a été enregistré comme interaction tant
            que l&apos;envoi n&apos;est pas confirmé.
          </p>
          <button
            type="button"
            onClick={onNouvelleTentative}
            className="self-start text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
          >
            Nouvelle tentative (après vérification)
          </button>
        </div>
      )}

      {etatEnvoi.statut === "echec" && (
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-medium text-[#dc2626]">{etatEnvoi.message}</p>
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

export default function BrouillonEmailFormulaire({
  intention,
  faits,
  destinataireEmail,
  gmailAutorise = false,
  destinataireCandidatType,
  destinataireCandidatId,
  tacheId,
  bienId,
}: {
  intention: IntentionCommunication;
  faits: FaitsCommunication;
  destinataireEmail?: string;
  gmailAutorise?: boolean;
  destinataireCandidatType?: "prospectVendeur" | "acquereur";
  destinataireCandidatId?: string;
  tacheId?: string;
  bienId?: string;
}) {
  const brouillonInitial = genererBrouillonEmail(intention, faits, "professionnel", destinataireEmail);
  const [ton, setTon] = useState<TonMessage>("professionnel");
  const [objet, setObjet] = useState(brouillonInitial.objet);
  const [corps, setCorps] = useState(brouillonInitial.corps);
  const [copie, setCopie] = useState(false);

  // Écran de confirmation explicite (ADR-031-bis) : jamais d'envoi à la génération du brouillon,
  // au chargement de page ni à une navigation — uniquement sur ce geste dédié. `idempotencyKey`
  // sert de `key` React à EcranConfirmationEnvoi : la faire changer remonte ce sous-arbre et lui
  // donne un `useActionState` propre.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const lienMailto = construireLienMailto(destinataireEmail, objet, corps);
  const mailtoTropLong = lienMailto.length > LONGUEUR_MAX_MAILTO;

  async function copierMessage() {
    await navigator.clipboard.writeText(`À : ${destinataireEmail ?? "(destinataire non renseigné)"}\nObjet : ${objet}\n\n${corps}`);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-medium text-[#64748b] mb-1.5">Ton</p>
        <div className="flex gap-2 flex-wrap">
          {TONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTon(t);
                const brouillon = genererBrouillonEmail(intention, faits, t, destinataireEmail);
                setObjet(brouillon.objet);
                setCorps(brouillon.corps);
              }}
              disabled={idempotencyKey !== null}
              className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${
                t === ton ? "bg-[#eef2ff] border-[#4338ca] text-[#4338ca]" : "border-[#e2e8f0] text-[#64748b]"
              }`}
            >
              {LABEL_TON_MESSAGE[t]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#94a3b8] mt-1.5">
          Changer de ton régénère le texte depuis les données du dossier — vos modifications manuelles sont alors
          remplacées.
        </p>
      </div>

      <div>
        <p className="text-[11px] font-medium text-[#64748b] mb-1">À</p>
        {destinataireEmail ? (
          <p className="text-[14px] text-[#0f172a]">{destinataireEmail}</p>
        ) : (
          <p className="text-[13px] text-[#dc2626]">Email impossible : adresse non renseignée</p>
        )}
      </div>

      {idempotencyKey === null && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#64748b]">Objet</span>
            <input
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[#64748b]">Corps</span>
            <textarea
              value={corps}
              onChange={(e) => setCorps(e.target.value)}
              rows={12}
              className="w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {destinataireEmail && !mailtoTropLong && (
              <a
                href={lienMailto}
                className="text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-3.5 py-2 rounded-lg"
              >
                Ouvrir dans le client mail
              </a>
            )}
            <button
              type="button"
              onClick={copierMessage}
              className="text-[13px] font-medium text-[#4338ca] border border-[#4338ca] hover:bg-[#eef2ff] transition-colors px-3.5 py-2 rounded-lg"
            >
              {copie ? "Copié !" : "Copier le message"}
            </button>
            {destinataireEmail && mailtoTropLong && (
              <p className="text-[12px] text-[#94a3b8]">Message trop long pour un lien mailto: — utilisez « Copier ».</p>
            )}
          </div>

          {gmailAutorise && destinataireEmail && (
            <div className="pt-3 border-t border-[#f1f5f9]">
              <p className="text-[12px] font-medium text-[#16a34a] mb-2">Gmail connecté</p>
              <button
                type="button"
                onClick={() => setIdempotencyKey(crypto.randomUUID())}
                className="text-[13px] font-medium text-white bg-[#16a34a] hover:bg-[#15803d] transition-colors px-3.5 py-2 rounded-lg"
              >
                Envoyer avec Gmail
              </button>
            </div>
          )}
        </>
      )}

      {idempotencyKey !== null && (
        <>
          <EcranConfirmationEnvoi
            key={idempotencyKey}
            idempotencyKey={idempotencyKey}
            destinataireEmail={destinataireEmail ?? ""}
            objet={objet}
            corps={corps}
            destinataireCandidatType={destinataireCandidatType}
            destinataireCandidatId={destinataireCandidatId}
            tacheId={tacheId}
            bienId={bienId}
            intention={intention}
            onAnnuler={() => setIdempotencyKey(null)}
            onNouvelleTentative={() => setIdempotencyKey(crypto.randomUUID())}
          />
          <div className="flex flex-wrap items-center gap-2">
            {destinataireEmail && !mailtoTropLong && (
              <a href={lienMailto} className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
                Ouvrir dans le client mail
              </a>
            )}
            <button type="button" onClick={copierMessage} className="text-[12px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
              {copie ? "Copié !" : "Copier le message"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
