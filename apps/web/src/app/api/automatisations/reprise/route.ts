import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reprendreExecutionsBloquees } from "@/lib/automatisations/reprise";

function secretValide(recu: string, attendu: string): boolean {
  const recuBuf = Buffer.from(recu);
  const attenduBuf = Buffer.from(attendu);
  if (recuBuf.length !== attenduBuf.length) return false;
  return timingSafeEqual(recuBuf, attenduBuf);
}

// Filet de reprise générique des executions_automatisation restées `a_traiter` après une
// interruption du process (ADR-038) — même patron d'authentification que /api/automatisations/scan
// (ADR-033), /api/compatibilite/scan et /api/compatibilite/baseline (ADR-036) : secret DÉDIÉ
// (`AUTOMATISATIONS_REPRISE_SECRET`, distinct d'AUTOMATISATIONS_SCAN_SECRET — responsabilité
// distincte, jamais mélangée à l'exécution/évaluation du scanner temporel ADR-033), en-tête
// `Authorization: Bearer <secret>`, comparaison en temps constant, jamais journalisé.
//
// Ne touche jamais evenements_metier ni configurations_automatisation : reprend exclusivement des
// exécutions déjà créées et déjà légitimes (activation figée ADR-032), jamais un rattrapage
// rétroactif. En régime normal, la quasi-totalité des exécutions sont déjà résolues de façon
// synchrone immédiatement après leur événement source ; ce point d'entrée ne fait donc
// généralement rien.
export async function POST(request: Request): Promise<NextResponse> {
  const secretAttendu = process.env.AUTOMATISATIONS_REPRISE_SECRET;
  if (!secretAttendu) {
    return NextResponse.json({ erreur: "Reprise indisponible : secret non configuré." }, { status: 503 });
  }

  const autorisation = request.headers.get("authorization") ?? "";
  const [schema, valeur] = autorisation.split(" ");
  if (schema !== "Bearer" || !valeur || !secretValide(valeur, secretAttendu)) {
    return NextResponse.json({ erreur: "Non autorisé." }, { status: 401 });
  }

  const resultat = await reprendreExecutionsBloquees();
  return NextResponse.json(resultat);
}
