import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { PRODUCT_NAME } from "@/lib/branding";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Réservée aux grands titres (direction artistique premium — sensation éditoriale), jamais à
// l'UI/aux données/aux formulaires : Inter reste seule pour tout le reste (voir globals.css,
// classe utilitaire `font-serif` appliquée ponctuellement). Même mécanisme `next/font/google` que
// Inter, déjà en place — aucune nouvelle dépendance npm, auto-hébergée par Next.js.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Le compagnon intelligent du conseiller immobilier.",
};

import AppShell from "@/components/layout/AppShell";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${fraunces.variable} h-full`}>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
