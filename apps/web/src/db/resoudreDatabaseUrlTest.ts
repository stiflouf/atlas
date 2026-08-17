// Garde-fou test/production (audit V1 Candidate) — point de résolution UNIQUE de la DATABASE_URL
// utilisée par la suite Vitest. Jamais un simple `process.env.DATABASE_URL ??= ...` dispersé dans
// 93 fichiers : ce module est appelé une seule fois, depuis vitest.setup.ts, AVANT l'import de tout
// module applicatif — les `??=` déjà présents dans les fichiers de test individuels deviennent des
// no-op (la variable est déjà fixée) et n'ont pas besoin d'être modifiés.
//
// Principe non négociable : la suite ne doit JAMAIS utiliser implicitement une DATABASE_URL de
// production déjà présente dans le shell. Cette fonction ignore délibérément `env.DATABASE_URL`
// pour construire la valeur de test — elle ne le lit que pour détecter un cas suspect et refuser
// explicitement, jamais pour s'en servir.
export const DATABASE_URL_TEST_PAR_DEFAUT = "postgresql://atlas:atlas@localhost:5432/atlas_test";

const IDENTIFIANTS_DEV_LOCAL_CONNUS = { hote: new Set(["localhost", "127.0.0.1"]), utilisateur: "atlas" };

// Type simple à propriétés nommées optionnelles plutôt que Partial<Pick<NodeJS.ProcessEnv, ...>> —
// NodeJS.ProcessEnv n'expose ces clés que via sa signature d'index, ce que la détection TypeScript
// des "types faibles" ignore lors de l'appel avec `process.env` directement (TS2559).
type EnvGardeDatabaseUrl = { ATLAS_TEST_DATABASE_URL?: string; DATABASE_URL?: string };

function analyser(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(
      `Garde DB de test : "${url}" n'est pas une URL Postgres valide (attendu : postgresql://utilisateur:motdepasse@hote:port/base).`
    );
  }
}

function estMarqueeCommeTest(url: URL): boolean {
  const nomBase = url.pathname.replace(/^\//, "");
  return /test/i.test(nomBase);
}

function estHoteLocalConnu(url: URL): boolean {
  return IDENTIFIANTS_DEV_LOCAL_CONNUS.hote.has(url.hostname);
}

function ressembleAuDevLocalDocumente(url: URL): boolean {
  return estHoteLocalConnu(url) && url.username === IDENTIFIANTS_DEV_LOCAL_CONNUS.utilisateur;
}

// Résout la DATABASE_URL à utiliser pour la suite Vitest à partir de l'environnement fourni (jamais
// lu directement dans process.env ici — testable en isolation, voir resoudreDatabaseUrlTest.test.ts).
export function resoudreDatabaseUrlTest(env: EnvGardeDatabaseUrl): string {
  const explicite = env.ATLAS_TEST_DATABASE_URL;
  if (explicite) {
    const url = analyser(explicite);
    if (!estHoteLocalConnu(url) || !estMarqueeCommeTest(url)) {
      throw new Error(
        `Garde DB de test : ATLAS_TEST_DATABASE_URL="${explicite}" refusée — hôte local requis (localhost/127.0.0.1) ` +
          `ET nom de base contenant explicitement "test" (ex. atlas_test). Jamais une base de production.`
      );
    }
    return explicite;
  }

  const ambiante = env.DATABASE_URL;
  if (ambiante) {
    const url = analyser(ambiante);
    if (!ressembleAuDevLocalDocumente(url)) {
      throw new Error(
        `Garde DB de test : ATLAS_TEST_DATABASE_URL absente, et DATABASE_URL="${ambiante}" présente dans l'environnement ` +
          `ne correspond pas à la convention locale de développement documentée (hôte localhost, utilisateur atlas). ` +
          `Refus de lancer la suite contre cette base — elle pourrait être une base de production. ` +
          `Définissez ATLAS_TEST_DATABASE_URL explicitement (voir apps/web/.env.test.example), ou retirez DATABASE_URL du shell.`
      );
    }
    // DATABASE_URL ressemble à la convention de dev locale documentée, mais n'est pas pour autant
    // utilisée telle quelle : la suite utilise toujours une base dédiée nommée explicitement "test"
    // (jamais la base de développement elle-même), voir DATABASE_URL_TEST_PAR_DEFAUT ci-dessus.
  }

  return DATABASE_URL_TEST_PAR_DEFAUT;
}
