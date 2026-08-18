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
      <nav className="flex flex-col gap-0.5">
        {items.map(({ label, href, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors duration-100 ${
                active ? "bg-white/10 text-champagne font-medium" : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
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
