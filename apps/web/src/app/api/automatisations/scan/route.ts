import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { scannerInactiviteProspectVendeur } from "@/lib/automatisations/scanTemporel";

function secretValide(recu: string, attendu: string): boolean {
  const recuBuf = Buffer.from(recu);
  const attenduBuf = Buffer.from(attendu);
  // Longueur vérifiée AVANT timingSafeEqual : la fonction lève sinon (buffers de tailles
  // différentes), ce qui romprait la comparaison en temps constant recherchée.
  if (recuBuf.length !== attenduBuf.length) return false;
  return timingSafeEqual(recuBuf, attenduBuf);
}

// Endpoint neutre (ADR-033) — jamais couplé à Vercel/Railway/GitHub Actions dans ce code : le
// déclenchement périodique reste la responsabilité d'un cron EXTERNE, configuré une fois
// l'hébergement définitivement choisi. Sans déclencheur externe configuré, le moteur temporel ne
// s'exécute jamais spontanément (documenté explicitement, docs/KNOWN_LIMITATIONS.md).
//
// Premier endpoint "machine" d'Atlas — aucune authentification n'existe ailleurs en dehors
// d'OAuth Google (ADR-006). Protégé par un secret partagé transmis en en-tête
// `Authorization: Bearer <secret>`, jamais en query string, comparaison en temps constant, jamais
// journalisé (y compris en cas d'échec — seul le fait "non autorisé" est loggé, jamais la valeur
// reçue).
export async function POST(request: Request): Promise<NextResponse> {
  const secretAttendu = process.env.AUTOMATISATIONS_SCAN_SECRET;
  if (!secretAttendu) {
    return NextResponse.json({ erreur: "Scan indisponible : secret non configuré." }, { status: 503 });
  }

  const autorisation = request.headers.get("authorization") ?? "";
  const [schema, valeur] = autorisation.split(" ");
  if (schema !== "Bearer" || !valeur || !secretValide(valeur, secretAttendu)) {
    return NextResponse.json({ erreur: "Non autorisé." }, { status: 401 });
  }

  const resultat = await scannerInactiviteProspectVendeur();
  return NextResponse.json(resultat);
}
