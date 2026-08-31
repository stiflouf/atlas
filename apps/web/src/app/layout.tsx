import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import { PRODUCT_NAME } from "@/lib/branding";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Réservée aux grands titres (direction artistique premium — sensation éditoriale), jamais à
// l'UI/aux données/aux formulaires : Inter reste seule pour tout le reste (voir globals.css,
// classe utilitaire `font-serif`, réservée aux 5 moments de marque du Lot 8B — H1 Aujourd'hui/Biens,
// titre/nom des heroes Bien/Acquéreur/Prospect vendeur). Poids 600/normal uniquement : c'est le
// seul poids réellement consommé par ces usages, aucune variante hypothétique préchargée.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  display: "swap",
  weight: ["600"],
  style: ["normal"],
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Le compagnon intelligent du conseiller immobilier.",
};

import AppShell from "@/components/layout/AppShell";
import { obtenirInitialesConseiller, obtenirNomConseiller } from "@/lib/conseiller";

// Seul point de lecture de l'identité affichée du conseiller : ce layout est un Server Component,
// il peut donc lire la variable d'environnement sans jamais l'exposer au bundle client. Elle
// descend ensuite en props jusqu'à la Sidebar (voir AppShell).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nomConseiller = obtenirNomConseiller();

  return (
    <html lang="fr" className={`${inter.variable} ${cormorant.variable} h-full`}>
      <body className="h-full">
        <AppShell nomConseiller={nomConseiller} initialesConseiller={obtenirInitialesConseiller(nomConseiller)}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
