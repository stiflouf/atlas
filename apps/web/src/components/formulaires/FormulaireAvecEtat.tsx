"use client";

import { useActionState, useEffect, useRef, useState, type FormHTMLAttributes, type ReactNode } from "react";
import { ETAT_FORMULAIRE_INITIAL, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

export type ActionFormulaire = (etatPrecedent: EtatFormulaire, formData: FormData) => Promise<EtatFormulaire>;

// React 19 réinitialise les champs NON contrôlés d'un <form action> dès que l'action a rendu sa
// valeur — y compris quand cette valeur est un refus de saisie. Sans cela, l'utilisateur perdrait
// tout ce qu'il vient de taper au moment même où on lui dit ce qui ne va pas. On remet donc en
// place la dernière saisie, champ par champ, après un état "erreur" : la valeur soumise redevient
// la valeur affichée. Les fichiers (`type="file"`) ne peuvent pas être restaurés par le navigateur :
// seule la sélection du fichier est à refaire, ses métadonnées saisies restent.
function restaurerSaisie(form: HTMLFormElement, saisie: FormData) {
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
    if (!element.name || !saisie.has(element.name)) continue;
    if (element instanceof HTMLInputElement) {
      if (element.type === "file" || element.type === "hidden" || element.type === "submit") continue;
      if (element.type === "checkbox" || element.type === "radio") {
        element.checked = saisie.getAll(element.name).includes(element.value);
        continue;
      }
    }
    const valeur = saisie.get(element.name);
    if (typeof valeur === "string") element.value = valeur;
  }
}

// FORM_FEEDBACK_V1 — LE `<form>` d'une Server Action à feedback : `useActionState` porte l'état
// rendu par l'action (`{ statut: "erreur", message }`) et l'affiche en `role="alert"`, sans
// navigation ; la saisie est restaurée (voir ci-dessus). Le succès reste une redirection décidée
// par l'action. Composant client minimal : les champs restent ceux de l'appelant (souvent un Server
// Component), le bouton utilise `BoutonSoumettre` (useFormStatus) pour le pending.
export default function FormulaireAvecEtat({
  action,
  children,
  className,
  positionErreur = "bas",
  ...rest
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: ActionFormulaire;
  children: ReactNode;
  // "haut" pour les formulaires longs : l'utilisateur voit le refus sans faire défiler.
  positionErreur?: "haut" | "bas";
}) {
  const [etat, soumettre] = useActionState(action, ETAT_FORMULAIRE_INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const derniereSaisie = useRef<FormData | null>(null);
  // Une nouvelle soumission efface l'ancien refus. Si l'action réussit par une redirection vers la
  // MÊME page (jalons prospect, onglets du bien), le composant reste monté avec son ancien état :
  // sans ce masquage, le refus précédent resterait affiché sous des données pourtant à jour.
  const [refusMasque, setRefusMasque] = useState(false);

  useEffect(() => {
    setRefusMasque(false);
    if (etat.statut === "erreur" && formRef.current && derniereSaisie.current) {
      restaurerSaisie(formRef.current, derniereSaisie.current);
    }
  }, [etat]);

  const alerte = etat.statut === "erreur" && !refusMasque && (
    <p
      role="alert"
      className="text-[13px] text-status-danger bg-status-danger-subtle border border-status-danger-border rounded-lg px-3 py-2"
    >
      {etat.message}
    </p>
  );

  return (
    <form
      {...rest}
      ref={formRef}
      action={(formData: FormData) => {
        derniereSaisie.current = formData;
        setRefusMasque(true);
        soumettre(formData);
      }}
      className={className}
    >
      {positionErreur === "haut" && alerte}
      {children}
      {positionErreur === "bas" && alerte}
    </form>
  );
}
