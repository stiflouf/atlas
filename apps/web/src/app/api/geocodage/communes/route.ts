import { NextResponse } from "next/server";
import { rechercherCommunes } from "@/lib/geocodage/ignClient";

// Proxy serveur pour l'autocomplétion de secteur de recherche acquéreur (ADR-035) — le client ne
// parle jamais directement à l'IGN. Recherche vide ou trop courte (< 2 caractères) : réponse vide
// immédiate, sans appel réseau inutile à chaque frappe.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ communes: [] });

  const communes = await rechercherCommunes(q);
  return NextResponse.json({ communes });
}
