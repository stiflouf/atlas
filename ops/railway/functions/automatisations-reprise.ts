// Railway Function cron (fichier unique, runtime Bun — contrainte plateforme, aucun import npm).
// Appelle POST /api/automatisations/reprise sur DOMIORA. Ne journalise jamais JOB_SECRET ni
// l'en-tête Authorization — voir docs/PILOT_RUNBOOK.md (section 5, Jobs périodiques) pour le contrat exact.
const NOM_JOB = "automatisations-reprise";
const ENDPOINT = "/api/automatisations/reprise";

const baseUrl = process.env.DOMIORA_BASE_URL;
const secret = process.env.JOB_SECRET;

if (!baseUrl) {
  console.error(`[${NOM_JOB}] variable manquante : DOMIORA_BASE_URL`);
  process.exit(1);
}
if (!secret) {
  console.error(`[${NOM_JOB}] variable manquante : JOB_SECRET`);
  process.exit(1);
}

const debut = Date.now();
let reponse: Response;
try {
  reponse = await fetch(`${baseUrl}${ENDPOINT}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
} catch (erreur) {
  console.error(`[${NOM_JOB}] échec réseau : ${erreur instanceof Error ? erreur.message : "erreur inconnue"}`);
  process.exit(1);
}
const dureeMs = Date.now() - debut;
const corps = await reponse.text();

if (!reponse.ok) {
  console.error(`[${NOM_JOB}] échec status=${reponse.status} duree_ms=${dureeMs} corps=${corps}`);
  process.exit(1);
}

console.log(`[${NOM_JOB}] ok status=${reponse.status} duree_ms=${dureeMs} resultat=${corps}`);
process.exit(0);
