"use client";

import { useActionState } from "react";
import { creerVisiteAction } from "@/actions/creerVisite";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import type { RetourVisite } from "@/lib/visites/retourVisite";

export type OptionPlanification = { id: string; label: string; detail?: string };
export type GroupeOptionsPlanification = { label: string; options: OptionPlanification[] };

// Un côté du couple bien/acquéreur : FIXÉ (arrivée depuis une fiche ou un match — champ caché, valeur
// affichée) ou SÉLECTIONNABLE (groupes d'options déjà ordonnés par l'appelant, ex. compatibles
// d'abord). Jamais recalculé ici : ce composant ne connaît ni le matching ni les repositories.
export type ChoixPlanification =
  | { mode: "fixe"; option: OptionPlanification }
  | { mode: "selection"; groupes: GroupeOptionsPlanification[] };

// VISIT_NATIVE_ENTRY_V1 — LE formulaire de planification d'une Visite native, réutilisé par la fiche
// Bien, la fiche Acquéreur et le matching (jamais trois formulaires). Jour civil uniquement :
// `visites.date_prevue` est un `date` SQL (ADR-040/041), aucun champ heure/durée qui serait perdu.
// `useActionState` : message d'erreur local + `pending` (bouton désactivé) contre le double submit —
// une seconde soumission pendant l'écriture ne part jamais.
export default function PlanifierVisiteForm({
  bien,
  acquereur,
  dateParDefaut,
  retour,
}: {
  bien: ChoixPlanification;
  acquereur: ChoixPlanification;
  dateParDefaut: string;
  retour?: RetourVisite;
}) {
  const [etat, soumettre, pending] = useActionState(creerVisiteAction, { statut: "idle" as const });

  return (
    <form action={soumettre} className="flex flex-col gap-4">
      {retour && <input type="hidden" name="retour" value={retour} />}

      <Champ id="planifier-visite-bien" label="Bien" nomChamp="bienId" choix={bien} vide="Choisir un bien" />
      <Champ id="planifier-visite-acquereur" label="Acquéreur" nomChamp="acquereurId" choix={acquereur} vide="Choisir un acquéreur" />

      <div>
        <label htmlFor="planifier-visite-date" className="text-[12px] font-medium text-text-secondary mb-1 block">
          Date de visite
        </label>
        <Input id="planifier-visite-date" type="date" name="datePrevue" defaultValue={dateParDefaut} required />
      </div>

      {etat.statut === "erreur" && (
        <p role="alert" className="text-[13px] text-status-danger bg-status-danger-subtle border border-status-danger-border rounded-lg px-3 py-2">
          {etat.message}
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
        <Button type="submit" variant="primary" size="md" loading={pending} disabled={pending} className="min-h-11 sm:min-h-0">
          Planifier la visite
        </Button>
        <p className="text-[12px] text-text-muted">Aucun agenda externe requis. La visite s'ouvre ensuite sur sa fiche.</p>
      </div>
    </form>
  );
}

function Champ({
  id,
  label,
  nomChamp,
  choix,
  vide,
}: {
  id: string;
  label: string;
  nomChamp: "bienId" | "acquereurId";
  choix: ChoixPlanification;
  vide: string;
}) {
  if (choix.mode === "fixe") {
    return (
      <div>
        <p className="text-[12px] font-medium text-text-secondary mb-1">{label}</p>
        <input type="hidden" name={nomChamp} value={choix.option.id} />
        <p className="text-[14px] font-medium text-text-primary">{choix.option.label}</p>
        {choix.option.detail && <p className="text-[12px] text-text-muted">{choix.option.detail}</p>}
      </div>
    );
  }

  const groupesNonVides = choix.groupes.filter((g) => g.options.length > 0);
  return (
    <div>
      <label htmlFor={id} className="text-[12px] font-medium text-text-secondary mb-1 block">
        {label}
      </label>
      <Select id={id} name={nomChamp} defaultValue="" required>
        <option value="" disabled>
          {vide}
        </option>
        {groupesNonVides.length === 1
          ? groupesNonVides[0].options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.detail ? ` — ${o.detail}` : ""}
              </option>
            ))
          : groupesNonVides.map((groupe) => (
              <optgroup key={groupe.label} label={groupe.label}>
                {groupe.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {o.detail ? ` — ${o.detail}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
      </Select>
    </div>
  );
}
