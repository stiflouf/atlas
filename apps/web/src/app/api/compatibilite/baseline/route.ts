import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { appliquerBaseline, calculerBaselineDryRun } from "@/lib/compatibilite/baseline";

function secretValide(recu: string, attendu: string): boolean {
  const recuBuf = Buffer.from(recu);
  const attenduBuf = Buffer.from(attendu);
  if (recuBuf.length !== attenduBuf.length) return false;
  return timingSafeEqual(recuBuf, attenduBuf);
}

// Outil explicite de baseline/rebuild (ADR-036) — geste manuel délibéré, JAMAIS déclenché
// automatiquement par une migration ou un déploiement. Secret DÉDIÉ (`COMPATIBILITE_BASELINE_SECRET`,
// distinct de COMPATIBILITE_SCAN_SECRET) : le identifiant utilisé par le cron externe pour le
// balayage de reprise ne doit jamais pouvoir, même par erreur de configuration, déclencher une
// baseline/rebuild — une opération volontairement plus rare et plus sensible.
//
// `mode` par défaut = "dry-run" (aucune écriture) — un `mode` absent, invalide, ou mal orthographié
// ne bascule jamais accidentellement en écriture. `apply` sur une table déjà non vide est refusé
// (409) sans `confirmerEcrasementExistant: true` explicite (protection contre un écrasement
// accidentel des cycles d'un système déjà en fonctionnement).
export async function POST(request: Request): Promise<NextResponse> {
  const secretAttendu = process.env.COMPATIBILITE_BASELINE_SECRET;
  if (!secretAttendu) {
    return NextResponse.json({ erreur: "Baseline indisponible : secret non configuré." }, { status: 503 });
  }

  const autorisation = request.headers.get("authorization") ?? "";
  const [schema, valeur] = autorisation.split(" ");
  if (schema !== "Bearer" || !valeur || !secretValide(valeur, secretAttendu)) {
    return NextResponse.json({ erreur: "Non autorisé." }, { status: 401 });
  }

  const corps = await request.json().catch(() => ({}));
  const mode = corps?.mode === "apply" ? "apply" : "dry-run";

  if (mode === "dry-run") {
    const rapport = await calculerBaselineDryRun();
    return NextResponse.json(rapport);
  }

  const resultat = await appliquerBaseline({ autoriserEcrasementExistant: corps?.confirmerEcrasementExistant === true });
  if (resultat.statut === "refuse_table_non_vide") {
    return NextResponse.json(
      {
        erreur: "La mémoire technique de compatibilité contient déjà des lignes — relancer avec confirmerEcrasementExistant: true pour un rebuild volontaire.",
        lignesExistantes: resultat.lignesExistantes,
      },
      { status: 409 }
    );
  }
  return NextResponse.json(resultat.rapport);
}
