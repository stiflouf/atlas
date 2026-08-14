// Backfill ponctuel et contrôlé du code commune INSEE canonique (ADR-035) pour les biens réels déjà
// existants — script autonome (aucune dépendance sur les alias "@/" du projet, volontairement
// autosuffisant pour rester exécutable en dehors de Next.js), à lancer manuellement.
//
// Usage :
//   DATABASE_URL=... node scripts/backfill-code-insee-commune.mjs             (dry-run, aucune écriture)
//   DATABASE_URL=... node scripts/backfill-code-insee-commune.mjs --apply     (applique les résolutions fiables)
//
// Règles strictes (ADR-035, section 16) :
// - Uniquement les champs d'adresse STRUCTURÉS du bien (adresse/ville/codePostal) — jamais
//   description/caracteristiques/notes/texte acquéreur.
// - Un résultat ambigu ou insuffisamment fiable -> aucune écriture, jamais une valeur inventée.
// - Un échec IGN (réseau/HTTP) -> aucune écriture.
// - Idempotent : ne retraite jamais un bien qui a déjà un code_insee_commune non NULL (qu'il ait
//   été posé par ce script ou par le flux applicatif normal, creerBienAction/modifierBienAction) —
//   relancer ce script ne peut donc jamais dégrader un résultat déjà correct, seulement tenter de
//   combler les NULL restants.
// - Le même seuil de fiabilité que l'application (SEUIL_FIABLE = 0.8, voir
//   src/lib/geocodage/qualite.ts) est reproduit ici à l'identique — si ce seuil change dans
//   l'application, ce script doit être mis à jour en conséquence (aucun import partagé possible :
//   les alias "@/" ne sont pas résolvables par un script Node autonome).

import postgres from "postgres";

const SEUIL_FIABLE = 0.8;
const ENDPOINT = "https://data.geopf.fr/geocodage/search";
const DELAI_ENTRE_APPELS_MS = 150; // courtoisie envers l'API publique, sans clé, partagée.

const modeApplication = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://atlas:atlas@localhost:5432/atlas";

function attendre(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reproduit exactement resoudreCommuneBien()/geocoderAdresse() (src/lib/geocodage/) — même requête,
// même seuil, même extraction de citycode.
async function resoudreCommune(adresse, ville, codePostal) {
  const q = `${adresse}, ${codePostal} ${ville}`;
  const url = `${ENDPOINT}?${new URLSearchParams({ q, limit: "1" })}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { statut: "erreur_reseau" };
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return { statut: "aucun_resultat" };
    const { score, citycode, city, postcode } = feature.properties ?? {};
    if (!citycode || !city || !postcode) return { statut: "reponse_incomplete" };
    if (typeof score !== "number" || score < SEUIL_FIABLE) return { statut: "score_insuffisant", score };
    return { statut: "resolu", citycode, city, postcode, score };
  } catch {
    return { statut: "erreur_reseau" };
  }
}

async function main() {
  const sql = postgres(databaseUrl);

  console.log(`Mode : ${modeApplication ? "APPLICATION (écriture)" : "DRY-RUN (aucune écriture)"}`);
  console.log("");

  const biens = await sql`
    select id, reference, adresse, ville, code_postal, code_insee_commune
    from biens
    where code_insee_commune is null
    order by cree_le
  `;

  console.log(`Biens sans code_insee_commune : ${biens.length}`);

  let resolus = 0;
  let scoreInsuffisant = 0;
  let aucunResultat = 0;
  let erreurReseau = 0;
  let reponseIncomplete = 0;
  const biensRestantSansCode = [];

  for (const bien of biens) {
    const resultat = await resoudreCommune(bien.adresse, bien.ville, bien.code_postal);

    if (resultat.statut === "resolu") {
      resolus += 1;
      console.log(
        `[résolu] ${bien.reference} — "${bien.adresse}, ${bien.code_postal} ${bien.ville}" -> ` +
          `${resultat.city} (${resultat.citycode}, score ${resultat.score.toFixed(2)})`
      );
      if (modeApplication) {
        await sql`update biens set code_insee_commune = ${resultat.citycode} where id = ${bien.id}`;
      }
    } else {
      biensRestantSansCode.push({ id: bien.id, reference: bien.reference });
      if (resultat.statut === "score_insuffisant") {
        scoreInsuffisant += 1;
        console.log(
          `[score insuffisant] ${bien.reference} — score ${resultat.score?.toFixed(2) ?? "n/a"} < ${SEUIL_FIABLE}`
        );
      } else if (resultat.statut === "aucun_resultat") {
        aucunResultat += 1;
        console.log(`[aucun résultat IGN] ${bien.reference}`);
      } else if (resultat.statut === "reponse_incomplete") {
        reponseIncomplete += 1;
        console.log(`[réponse IGN incomplète] ${bien.reference}`);
      } else {
        erreurReseau += 1;
        console.log(`[erreur réseau/HTTP] ${bien.reference}`);
      }
    }

    await attendre(DELAI_ENTRE_APPELS_MS);
  }

  console.log("");
  console.log("=== Résumé ===");
  console.log(`Biens analysés            : ${biens.length}`);
  console.log(`Résolus avec certitude    : ${resolus}${modeApplication ? " (écrits)" : " (seraient écrits)"}`);
  console.log(`Score insuffisant (<${SEUIL_FIABLE}) : ${scoreInsuffisant}`);
  console.log(`Aucun résultat IGN        : ${aucunResultat}`);
  console.log(`Réponse IGN incomplète    : ${reponseIncomplete}`);
  console.log(`Erreur réseau/HTTP        : ${erreurReseau}`);
  console.log(`Total restant sans code   : ${biensRestantSansCode.length}`);
  if (biensRestantSansCode.length > 0) {
    console.log("");
    console.log("Biens restant sans code_insee_commune :");
    for (const b of biensRestantSansCode) console.log(`  - ${b.reference} (${b.id})`);
  }

  if (!modeApplication && resolus > 0) {
    console.log("");
    console.log(`Dry-run terminé — relancer avec --apply pour écrire les ${resolus} résolutions ci-dessus.`);
  }

  await sql.end();
}

main().catch((erreur) => {
  console.error("Échec du backfill :", erreur);
  process.exit(1);
});
