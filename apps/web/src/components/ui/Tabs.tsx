"use client";

import { useEffect, useRef, useState } from "react";

export function getTabId(idBase: string, id: string): string {
  return `${idBase}-tab-${id}`;
}

export function getTabPanelId(idBase: string, id: string): string {
  return `${idBase}-panel-${id}`;
}

export type TabItem<T extends string> = {
  id: T;
  label: string;
};

type Props<T extends string> = {
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  idBase: string;
};

// Barre d'onglets accessible — extraite de BienTabs.tsx (Lot 10A), même comportement de scroll/
// affordance qu'avant, mêmes tokens sémantiques. Activation manuelle (WAI-ARIA APG) : les flèches
// déplacent uniquement le focus, jamais l'onglet actif — `active` reste seul propriétaire de la
// sélection, contrôlé par l'appelant. `focusedId` est un état purement interne au clavier, distinct
// de `active`, pour un roving tabindex correct pendant la navigation (sans lui, un onglet visité au
// clavier mais pas encore activé n'aurait tabIndex=0 nulle part).
export default function Tabs<T extends string>({ tabs, active, onChange, idBase }: Props<T>) {
  const conteneurRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const boutonsRef = useRef(new Map<T, HTMLButtonElement>());
  const [debordementGauche, setDebordementGauche] = useState(false);
  const [debordementDroite, setDebordementDroite] = useState(false);
  const [focusedId, setFocusedId] = useState<T>(active);

  function mettreAJourDebordement() {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;
    setDebordementGauche(conteneur.scrollLeft > 2);
    setDebordementDroite(conteneur.scrollLeft + conteneur.clientWidth < conteneur.scrollWidth - 2);
  }

  useEffect(() => {
    mettreAJourDebordement();
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;
    mettreAJourDebordement();
    conteneur.addEventListener("scroll", mettreAJourDebordement, { passive: true });
    window.addEventListener("resize", mettreAJourDebordement);
    return () => {
      conteneur.removeEventListener("scroll", mettreAJourDebordement);
      window.removeEventListener("resize", mettreAJourDebordement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `active` ne change que par activation (clic, Enter/Space natifs sur le bouton déjà focalisé) —
  // le focus clavier doit donc s'aligner dessus à cet instant précis.
  useEffect(() => {
    setFocusedId(active);
  }, [active]);

  // Liste dynamique (ex. l'onglet Historique apparaît/disparaît selon les données) : si l'onglet
  // actuellement focalisé disparaît, retomber sur l'onglet actif s'il existe encore, sinon sur le
  // premier onglet disponible. Ne déclenche jamais onChange : le contrat de l'appelant garantit un
  // `active` valide pendant le montage.
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === focusedId)) {
      setFocusedId(tabs.some((tab) => tab.id === active) ? active : tabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, focusedId, active]);

  function gererClavier(evenement: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let indexSuivant: number | undefined;
    if (evenement.key === "ArrowRight") indexSuivant = (index + 1) % tabs.length;
    else if (evenement.key === "ArrowLeft") indexSuivant = (index - 1 + tabs.length) % tabs.length;
    else if (evenement.key === "Home") indexSuivant = 0;
    else if (evenement.key === "End") indexSuivant = tabs.length - 1;
    if (indexSuivant === undefined) return;
    evenement.preventDefault();
    const bouton = boutonsRef.current.get(tabs[indexSuivant].id);
    bouton?.focus();
    // Le défilement natif déclenché par focus() n'amène pas toujours l'onglet entièrement dans le
    // champ visible à l'intérieur du conteneur scrollable (constaté sur mobile) — explicite comme
    // pour l'onglet actif ci-dessus.
    bouton?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }

  return (
    <div className="relative mb-6">
      {/* Onglets — affordance de scroll (chantier A) : dégradé de bord dès qu'il reste du contenu
          caché, jamais affiché quand tous les onglets tiennent (ex. desktop large, chantier B). */}
      <div
        ref={conteneurRef}
        role="tablist"
        className="flex overflow-x-auto gap-0 border-b border-border-subtle scrollbar-none scroll-smooth"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) boutonsRef.current.set(tab.id, el);
              else boutonsRef.current.delete(tab.id);
              if (tab.id === active) activeRef.current = el;
            }}
            type="button"
            role="tab"
            id={getTabId(idBase, tab.id)}
            aria-controls={getTabPanelId(idBase, tab.id)}
            aria-selected={tab.id === active}
            tabIndex={tab.id === focusedId ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onFocus={() => setFocusedId(tab.id)}
            onKeyDown={(e) => gererClavier(e, index)}
            className={`shrink-0 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring ${
              tab.id === active
                ? "border-action-primary text-action-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {debordementGauche && (
        <div className="pointer-events-none absolute left-0 top-0 bottom-[1px] w-8 bg-gradient-to-r from-surface to-transparent" />
      )}
      {debordementDroite && (
        <div className="pointer-events-none absolute right-0 top-0 bottom-[1px] w-8 bg-gradient-to-l from-surface to-transparent" />
      )}
    </div>
  );
}
