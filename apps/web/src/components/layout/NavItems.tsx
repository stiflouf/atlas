"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Building2, Users, LayoutDashboard, Landmark } from "lucide-react";

const items = [
  { label: "Aujourd'hui", href: "/", icon: Home },
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard },
  { label: "Biens", href: "/biens", icon: Building2 },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Fiscal", href: "/fiscal", icon: Landmark },
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
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-100 ${
                active
                  ? "bg-[#eef2ff] text-[#4338ca] font-medium"
                  : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"
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
              active ? "text-[#4338ca]" : "text-[#94a3b8]"
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
