import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { balayerResynchronisationsEnAttente } from "@/lib/compatibilite/traitementResynchronisation";

function secretValide(recu: string, attendu: string): boolean {
  const recuBuf = Buffer.from(recu);
  const attenduBuf = Buffer.from(attendu);
  if (recuBuf.length !== attenduBuf.length) return false;
  return timingSafeEqual(recuBuf, attenduBuf);
}

// Filet de reprise du handoff durable de compatibilité (ADR-036) — même patron d'authentification
// que /api/automatisations/scan (ADR-033) : secret partagé, en-tête `Authorization: Bearer
// <secret>`, comparaison en temps constant, jamais journalisé. Endpoint DÉDIÉ plutôt qu'une
// extension du scan ADR-033 : responsabilité distincte (resynchronisation de compatibilité, pas
// exécution de règles d'automatisation), même si le mécanisme de déclenchement externe (cron) est
// identique — mélanger les deux aurait rendu chaque route moins lisible pour un gain nul.
//
// Traite les demandes de `compatibilites_a_resynchroniser` encore en attente (`traitee_le IS
// NULL`) — celles jamais traitées (crash entre le commit de la mutation source et le traitement
// synchrone) et celles en échec (retraitées automatiquement, jamais un état terminal). En régime
// normal, la quasi-totalité des demandes sont déjà traitées de façon synchrone immédiatement après
// leur mutation source ; ce point d'entrée ne fait donc généralement rien.
export async function POST(request: Request): Promise<NextResponse> {
  const secretAttendu = process.env.COMPATIBILITE_SCAN_SECRET;
  if (!secretAttendu) {
    return NextResponse.json({ erreur: "Scan indisponible : secret non configuré." }, { status: 503 });
  }

  const autorisation = request.headers.get("authorization") ?? "";
  const [schema, valeur] = autorisation.split(" ");
  if (schema !== "Bearer" || !valeur || !secretValide(valeur, secretAttendu)) {
    return NextResponse.json({ erreur: "Non autorisé." }, { status: 401 });
  }

  const resultat = await balayerResynchronisationsEnAttente();
  return NextResponse.json(resultat);
}
