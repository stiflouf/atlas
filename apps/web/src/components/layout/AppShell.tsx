"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

// /connexion (ADR-047) reste sans chrome applicatif : la navigation qu'il propose n'a aucun sens
// avant l'obtention d'une session Atlas (le Proxy renverrait de toute façon vers /connexion).
const CHEMINS_SANS_CHROME = new Set(["/connexion"]);

// `nomConseiller`/`initialesConseiller` sont résolus côté serveur par le Root Layout et traversent
// ce composant sans être lus ici : AppShell est un Client Component (il a besoin de usePathname),
// et une variable d'environnement non publique n'y serait jamais disponible.
export default function AppShell({
  children,
  nomConseiller,
  initialesConseiller,
}: {
  children: React.ReactNode;
  nomConseiller: string;
  initialesConseiller: string;
}) {
  const pathname = usePathname();
  if (CHEMINS_SANS_CHROME.has(pathname)) {
    return <div className="h-full bg-page">{children}</div>;
  }

  return (
    <div className="flex h-full bg-page">
      <Sidebar nomConseiller={nomConseiller} initialesConseiller={initialesConseiller} />
      <main className="flex-1 overflow-y-auto pb-14 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
