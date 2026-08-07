import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atlas",
  description: "Le compagnon intelligent du conseiller immobilier.",
};

import AppShell from "@/components/layout/AppShell";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} h-full`}>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
