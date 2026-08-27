"use client";

import { useState } from "react";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

type Option = { id: string; label: string };
export type CiblesTache = { bienId: string; acquereurId: string; prospectVendeurId: string };

// Exclusivité des trois cibles (logique pure, testable sans DOM) — correctif UX : le garde métier
// "au plus une cible" existait déjà côté serveur (creerTache.ts, miroir du CHECK
// taches_une_seule_cible_check) mais rien n'empêchait auparavant de sélectionner les trois en même
// temps dans le formulaire, menant systématiquement à un rejet backend évitable. Choisir une cible
// non vide vide systématiquement les deux autres (solution A du chantier, la plus étroite) ;
// repasser la cible déjà active à "Aucun" ne touche pas les deux autres (déjà vides par
// construction, cet appel ne fait jamais que les deux autres soient non vides simultanément).
export function appliquerExclusiviteCible(
  cibles: CiblesTache,
  champModifie: keyof CiblesTache,
  valeur: string
): CiblesTache {
  if (!valeur) return { ...cibles, [champModifie]: "" };
  return { bienId: "", acquereurId: "", prospectVendeurId: "", [champModifie]: valeur };
}

// Le garde backend n'est PAS remplacé par cette UI : une requête forgée avec plusieurs cibles
// reste rejetée par creerTache.ts, cette exclusivité n'empêche que l'erreur normale d'un
// utilisateur réel dans ce formulaire.
export default function CibleTacheSelecteur({
  biens,
  acquereurs,
  prospectsVendeurs,
  bienIdInitial,
  acquereurIdInitial,
  prospectVendeurIdInitial,
}: {
  biens: Option[];
  acquereurs: Option[];
  prospectsVendeurs: Option[];
  bienIdInitial: string;
  acquereurIdInitial: string;
  prospectVendeurIdInitial: string;
}) {
  const [cibles, setCibles] = useState<CiblesTache>({
    bienId: bienIdInitial,
    acquereurId: acquereurIdInitial,
    prospectVendeurId: prospectVendeurIdInitial,
  });

  return (
    <div className="border-t border-border pt-4 mt-2">
      <p className="text-[12px] text-text-3 mb-3">
        Une tâche peut être rattachée à une seule cible à la fois — un bien, un acquéreur ou un
        prospect vendeur — ou à aucun des trois pour une tâche générale.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Bien</label>
          <select
            name="bienId"
            value={cibles.bienId}
            onChange={(e) => setCibles((c) => appliquerExclusiviteCible(c, "bienId", e.target.value))}
            className={inputCls}
          >
            <option value="">Aucun</option>
            {biens.map((bien) => (
              <option key={bien.id} value={bien.id}>
                {bien.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Acquéreur</label>
          <select
            name="acquereurId"
            value={cibles.acquereurId}
            onChange={(e) => setCibles((c) => appliquerExclusiviteCible(c, "acquereurId", e.target.value))}
            className={inputCls}
          >
            <option value="">Aucun</option>
            {acquereurs.map((acquereur) => (
              <option key={acquereur.id} value={acquereur.id}>
                {acquereur.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Prospect vendeur</label>
          <select
            name="prospectVendeurId"
            value={cibles.prospectVendeurId}
            onChange={(e) => setCibles((c) => appliquerExclusiviteCible(c, "prospectVendeurId", e.target.value))}
            className={inputCls}
          >
            <option value="">Aucun</option>
            {prospectsVendeurs.map((prospect) => (
              <option key={prospect.id} value={prospect.id}>
                {prospect.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
