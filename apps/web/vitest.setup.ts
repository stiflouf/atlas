// Exécuté par Vitest AVANT le chargement de chaque fichier de test (setupFiles) — donc avant toute
// ligne `process.env.DATABASE_URL ??= ...` présente dans les fichiers de test individuels, qui
// deviennent de simples no-op une fois DATABASE_URL déjà fixée ici. Garde-fou test/production
// (audit V1 Candidate) : voir src/db/resoudreDatabaseUrlTest.ts pour la logique de résolution.
import { resoudreDatabaseUrlTest } from "./src/db/resoudreDatabaseUrlTest";

process.env.DATABASE_URL = resoudreDatabaseUrlTest({
  ATLAS_TEST_DATABASE_URL: process.env.ATLAS_TEST_DATABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
});
