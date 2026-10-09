import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ErreurModeRetentionNonSupporte, executerDryRunRetention } from "@/lib/retention/dryRunRetention";
import { APPLY_SUPPORTED, MODE_RETENTION_V1 } from "@/lib/retention/statutsRetention";

function secretValide(recu: string, attendu: string): boolean {
  const recuBuf = Buffer.from(recu);
  const attenduBuf = Buffer.from(attendu);
  // Longueur vérifiée AVANT timingSafeEqual : la fonction lève sinon (buffers de tailles
  // différentes), ce qui romprait la comparaison en temps constant recherchée.
  if (recuBuf.length !== attenduBuf.length) return false;
  return timingSafeEqual(recuBuf, attenduBuf);
}

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — route MACHINE de dry-run de rétention.
//
// Patron d'authentification identique aux quatre routes machine existantes (ADR-033, ADR-036) :
// secret partagé en en-tête `Authorization: Bearer <secret>`, jamais en query string, comparaison en
// temps constant, secret absent de la configuration = 503 et jamais un traitement anonyme, valeur
// reçue JAMAIS journalisée ni renvoyée (seul le fait « non autorisé » sort). Secret DÉDIÉ
// (`RETENTION_DRY_RUN_SECRET`) : aucun secret de cron existant ne doit pouvoir, même par erreur de
// configuration, déclencher un balayage de rétention.
//
// AUCUN CRON. Contrairement à /api/automatisations/scan, cette route n'est appelée par aucun
// planificateur et ce lot n'en configure aucun : elle suit le précédent de
// /api/compatibilite/baseline, seule route machine dont le déclenchement est un geste humain
// explicite. Un balayage de rétention qui tournerait tout seul chaque nuit n'aurait rien à supprimer
// aujourd'hui — mais il installerait l'habitude d'un chemin automatique vers une opération
// irréversible, avant que la moindre garde (suspension pour contentieux, suppression de fichier)
// n'existe.
//
// `mode` par défaut = "dry-run", et "apply" est REFUSÉ : non pas « pas encore implémenté », mais
// refusé par une garde explicite dans le service ET ici. APPLY_SUPPORTED reste false.
//
// Aucune session sur ce chemin : la garde est le Bearer, jamais un `exigerWorkspaceCourant()` —
// le balayage est global et parcourt tous les workspaces, chacun avec son propre run.
export async function POST(request: Request): Promise<NextResponse> {
  const secretAttendu = process.env.RETENTION_DRY_RUN_SECRET;
  if (!secretAttendu) {
    return NextResponse.json({ erreur: "Dry-run de rétention indisponible : secret non configuré." }, { status: 503 });
  }

  const autorisation = request.headers.get("authorization") ?? "";
  const [schema, valeur] = autorisation.split(" ");
  if (schema !== "Bearer" || !valeur || !secretValide(valeur, secretAttendu)) {
    return NextResponse.json({ erreur: "Non autorisé." }, { status: 401 });
  }

  const corps = await request.json().catch(() => ({}));
  const modeDemande = typeof corps?.mode === "string" ? corps.mode : MODE_RETENTION_V1;

  try {
    const resultats = await executerDryRunRetention({ mode: modeDemande });
    return NextResponse.json({ mode: MODE_RETENTION_V1, applySupported: APPLY_SUPPORTED, workspaces: resultats });
  } catch (erreur) {
    if (erreur instanceof ErreurModeRetentionNonSupporte) {
      // 400 et non 501 : la requête est malformée au regard de ce que le produit expose. Le message
      // ne laisse aucune ambiguïté sur le fait qu'aucune purge n'existe.
      return NextResponse.json({ erreur: erreur.message, applySupported: APPLY_SUPPORTED }, { status: 400 });
    }
    throw erreur;
  }
}
