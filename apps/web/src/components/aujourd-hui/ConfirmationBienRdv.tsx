"use client";

import { useState } from "react";
import Link from "next/link";

type Candidat = { bienId: string; titre: string };
type Etat = "attente" | "choix" | "confirme" | "ignore";

// Validation humaine d'un bien ambigu. L'état reste local à ce composant — il n'est pas
// persisté (pas de base de données pour ce sprint) : un rafraîchissement de page réaffichera
// la question. Le lien "Préparer" pointe toujours vers /visites/{rdvId}/preparer, qui résout
// son propre contexte de façon indépendante ; le bien choisi ici sert uniquement de retour
// visuel immédiat au conseiller, pas à transmettre un choix à la page suivante.
export default function ConfirmationBienRdv({
  rdvId,
  candidats,
}: {
  rdvId: string;
  candidats: Candidat[];
}) {
  const [etat, setEtat] = useState<Etat>("attente");
  const [choisi, setChoisi] = useState<Candidat>(candidats[0]);

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
          <button
            key={c.bienId}
            onClick={() => {
              setChoisi(c);
              setEtat("confirme");
            }}
            className="text-[#4338ca] font-medium"
          >
            {c.titre}
          </button>
        ))}
        <button onClick={() => setEtat("ignore")} className="text-[#94a3b8]">
          Annuler
        </button>
      </div>
    );
  }

  return (
    <div className="text-[12px] text-[#64748b] max-w-[200px] text-right">
      <p className="mb-1.5 leading-snug">Ce rendez-vous concerne-t-il {candidats[0].titre} ?</p>
      <div className="flex flex-wrap justify-end gap-x-2 gap-y-1">
        <button
          onClick={() => {
            setChoisi(candidats[0]);
            setEtat("confirme");
          }}
          className="font-medium text-[#4338ca]"
        >
          Oui
        </button>
        {candidats.length > 1 && (
          <button onClick={() => setEtat("choix")} className="text-[#64748b]">
            Choisir un autre bien
          </button>
        )}
        <button onClick={() => setEtat("ignore")} className="text-[#94a3b8]">
          Ignorer
        </button>
      </div>
    </div>
  );
}
