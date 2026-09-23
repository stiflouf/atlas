"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Home, Building2, BookUser, Users, LayoutDashboard, Landmark, UserSearch, Zap } from "lucide-react";

const items = [
  { label: "Aujourd'hui", href: "/", icon: Home },
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard },
  { label: "Biens", href: "/biens", icon: Building2 },
  // ADR-058 — le carnet de personnes, avant les vues de pipeline (acquéreurs, prospects vendeurs).
  { label: "Contacts", href: "/contacts", icon: BookUser },
  // DEMO_UX_HARDENING_V1 — « Acquéreurs » partout à l'écran : la route reste /clients (aucun
  // renommage technique), mais le produit n'emploie plus deux mots pour la même personne.
  { label: "Acquéreurs", href: "/clients", icon: Users },
  { label: "Prospects vendeurs", href: "/prospects-vendeurs", icon: UserSearch },
  { label: "Fiscal", href: "/fiscal", icon: Landmark },
  { label: "Automatisations", href: "/automatisations", icon: Zap },
];

type Props = { variant: "sidebar" | "bottom" };

export default function NavItems({ variant }: Props) {
  const pathname = usePathname();
  const conteneurRef = useRef<HTMLElement>(null);
  const actifRef = useRef<HTMLAnchorElement>(null);

  // Barre du bas uniquement : amener l'entrée courante dans la zone visible. `inline: "nearest"`
  // ne bouge rien quand elle y est déjà, et `block: "nearest"` évite tout défilement vertical de
  // la page — une barre `fixed` ne doit jamais faire sauter le contenu.
  useEffect(() => {
    if (variant !== "bottom") return;
    actifRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [variant, pathname]);

  if (variant === "sidebar") {
    return (
      <nav aria-label="Navigation principale" className="flex flex-col gap-1">
        {items.map(({ label, href, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-lg text-[13px] transition-colors duration-100 ${
                active
                  ? "bg-white/[0.08] text-text-inverse font-medium"
                  : "text-text-inverse/65 hover:bg-white/5 hover:text-text-inverse"
              }`}
            >
              {/* Repère d'onglet actif — champagne, discret (§4 : subtil, jamais un bloc plein). */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-champagne" />
              )}
              <span
                className={`inline-flex items-center justify-center shrink-0 w-7 h-7 rounded-md transition-colors ${
                  active ? "bg-champagne/15 text-champagne" : "text-text-inverse/55"
                }`}
              >
                <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
              </span>
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  // DEMO_UX_HARDENING_V1 — la barre du bas portait les 8 mêmes entrées en `px-6`, sans
  // compression possible (`min-width:auto` sur un flex item) ni débordement géré : ~800 px de
  // contenu incompressible pour 375 px d'écran, donc la moitié des entrées peintes hors de la
  // barre et inatteignables au doigt. On garde les 8 entrées — la fiche Contact, les vues de
  // pipeline et le fiscal sont tous des destinations réelles du parcours — et on rend la barre
  // DÉFILANTE, sur le patron déjà en production dans `components/ui/Tabs.tsx` : items insécables
  // (`whitespace-nowrap`) et non compressés (`shrink-0`), padding resserré, et l'entrée courante
  // ramenée dans la zone visible à l'affichage pour qu'on sache toujours où l'on est.
  return (
    <nav
      ref={conteneurRef}
      aria-label="Navigation principale"
      className="flex items-center h-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map(({ label, href, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            ref={active ? actifRef : undefined}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center shrink-0 whitespace-nowrap gap-1 py-2 px-3 transition-colors duration-100 ${
              active ? "text-navy" : "text-text-muted"
            }`}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
