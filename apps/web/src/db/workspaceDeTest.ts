// ADR-054 — identifiant du workspace historique, créé par la migration 0032.
//
// Destiné aux TESTS uniquement, sur le même précédent que `resoudreDatabaseUrlTest.ts` (fichier non
// `.test.ts` mais dont le seul consommateur est la suite) : les tests d'intégration écrivent dans
// des tables racines et doivent désormais nommer explicitement leur périmètre, puisque la migration
// 0033 a retiré le DEFAULT SQL.
//
// AUCUN code de production ne doit importer cette constante. Le produit résout son périmètre soit
// depuis la session (`exigerWorkspaceCourant`), soit depuis la base (`resoudreWorkspaceExecutionMachine`)
// — jamais depuis un littéral, précisément pour que l'apparition d'un second workspace ne puisse
// pas passer inaperçue. Un test structurel verrouille cette règle.
export const WORKSPACE_TEST = "default";
