"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Building2, Users, LayoutDashboard, Landmark, UserSearch, Zap } from "lucide-react";

const items = [
  { label: "Aujourd'hui", href: "/", icon: Home },
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard },
  { label: "Biens", href: "/biens", icon: Building2 },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Prospects vendeurs", href: "/prospects-vendeurs", icon: UserSearch },
  { label: "Fiscal", href: "/fiscal", icon: Landmark },
  { label: "Automatisations", href: "/automatisations", icon: Zap },
];

type Props = { variant: "sidebar" | "bottom" };

export default function NavItems({ variant }: Props) {
  const pathname = usePathname();

  if (variant === "sidebar") {
    return (
      <nav className="flex flex-col gap-1">
        {items.map(({ label, href, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-lg text-[13px] transition-colors duration-100 ${
                active ? "bg-white/[0.08] text-white font-medium" : "text-white/65 hover:bg-white/5 hover:text-white"
              }`}
            >
              {/* Repère d'onglet actif — champagne, discret (§4 : subtil, jamais un bloc plein). */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-champagne" />
              )}
              <span
                className={`inline-flex items-center justify-center shrink-0 w-7 h-7 rounded-md transition-colors ${
                  active ? "bg-champagne/15 text-champagne" : "text-white/55"
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

  return (
    <nav className="flex items-center justify-around h-full">
      {items.map(({ label, href, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-1 py-2 px-6 transition-colors duration-100 ${
              active ? "text-navy" : "text-text-3"
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
