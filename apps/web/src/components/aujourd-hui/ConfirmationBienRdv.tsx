"use client";

import { useState } from "react";
import Link from "next/link";
import { enregistrerValidationBien } from "@/actions/validationRendezVous";

type Candidat = { bienId: string; titre: string };
type Etat = "attente" | "choix" | "confirme" | "ignore";

// Validation humaine d'un bien ambigu. La décision est persistée (Sprint 4, ADR-006) : au
// prochain chargement, elle sera utilisée avant toute règle automatique. La transition de l'UI
// reste optimiste — elle ne bloque pas sur la réponse du serveur — et l'appel est best-effort :
// un échec d'écriture réaffichera simplement la question au prochain chargement, sans casser
// l'interaction en cours.
export default function ConfirmationBienRdv({
  rdvId,
  candidats,
}: {
  rdvId: string;
  candidats: Candidat[];
}) {
  const [etat, setEtat] = useState<Etat>("attente");
  const [choisi, setChoisi] = useState<Candidat>(candidats[0]);

  function valider(candidat: Candidat, decision: "confirme" | "corrige") {
    setChoisi(candidat);
    setEtat("confirme");
    enregistrerValidationBien(rdvId, decision, candidat.bienId).catch((erreur) => {
      console.error("[confirmation-bien] échec de l'enregistrement :", erreur);
    });
  }

  function ignorer() {
    setEtat("ignore");
    enregistrerValidationBien(rdvId, "ignore", null).catch((erreur) => {
      console.error("[confirmation-bien] échec de l'enregistrement :", erreur);
    });
  }

  if (etat === "ignore" || candidats.length === 0) return null;

  if (etat === "confirme") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <p className="text-[11px] text-[#94a3b8]">Bien confirmé : {choisi.titre}</p>
        <Link
          href={`/visites/${rdvId}/preparer`}
          className="shrink-0 self-end min-h-[44px] flex items-center text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors"
        >
          Préparer&nbsp;→
        </Link>
      </div>
    );
  }

  if (etat === "choix") {
    return (
      <div className="flex flex-col items-end gap-1 text-[12px]">
        {candidats.map((c) => (
          <button key={c.bienId} onClick={() => valider(c, "corrige")} className="text-[#4338ca] font-medium">
            {c.titre}
          </button>
        ))}
        <button onClick={ignorer} className="text-[#94a3b8]">
          Annuler
        </button>
      </div>
    );
  }

  return (
    <div className="text-[12px] text-[#64748b] max-w-[200px] text-right">
      <p className="mb-1.5 leading-snug">Ce rendez-vous concerne-t-il {candidats[0].titre} ?</p>
      <div className="flex flex-wrap justify-end gap-x-2 gap-y-1">
        <button onClick={() => valider(candidats[0], "confirme")} className="font-medium text-[#4338ca]">
          Oui
        </button>
        {candidats.length > 1 && (
          <button onClick={() => setEtat("choix")} className="text-[#64748b]">
            Choisir un autre bien
          </button>
        )}
        <button onClick={ignorer} className="text-[#94a3b8]">
          Ignorer
        </button>
      </div>
    </div>
  );
}
