"use client";

import { useState } from "react";
import {
  LABEL_TON_MESSAGE,
  type FaitsCommunication,
  type IntentionCommunication,
  type TonMessage,
} from "@/lib/communications/contexteCommunication";
import { genererBrouillonEmail } from "@/lib/communications/genererBrouillonEmail";
import { construireLienMailto } from "@/lib/communications/mailto";

const TONS: TonMessage[] = ["professionnel", "cordial", "court", "relance_douce"];

// Au-delà de cette longueur, un lien mailto: devient peu fiable selon les navigateurs/clients mail
// (limite pratique observée autour de 2000 caractères) — la copie reste alors le seul moyen
// proposé, jamais un échec silencieux (ADR-031, correction n°3).
const LONGUEUR_MAX_MAILTO = 1800;

export default function BrouillonEmailFormulaire({
  intention,
  faits,
  destinataireEmail,
}: {
  intention: IntentionCommunication;
  faits: FaitsCommunication;
  destinataireEmail?: string;
}) {
  const brouillonInitial = genererBrouillonEmail(intention, faits, "professionnel", destinataireEmail);
  const [ton, setTon] = useState<TonMessage>("professionnel");
  const [objet, setObjet] = useState(brouillonInitial.objet);
  const [corps, setCorps] = useState(brouillonInitial.corps);
  const [copie, setCopie] = useState(false);

  function regenererAvecTon(nouveauTon: TonMessage) {
    setTon(nouveauTon);
    const brouillon = genererBrouillonEmail(intention, faits, nouveauTon, destinataireEmail);
    setObjet(brouillon.objet);
    setCorps(brouillon.corps);
  }

  // Reconstruit depuis le texte ACTUELLEMENT ÉDITÉ (objet/corps), jamais depuis le brouillon
  // initial — correction n°3.
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
              onClick={() => regenererAvecTon(t)}
              className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${
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
    </div>
  );
}
