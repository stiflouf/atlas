import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // dashboardRepository.test.ts lit des agrégats globaux (pas de filtre par bienId comme les
    // autres suites) : en parallèle, les insertions/suppressions d'autres fichiers dans les mêmes
    // tables (offres/compromis/comptes_rendus_visite) le font flaker (~1 test sur 4 observé).
    // Fichiers exécutés séquentiellement plutôt que d'isoler un seul fichier — Vitest ne permet
    // pas de désactiver le parallélisme pour un fichier sans l'imposer aux autres.
    fileParallelism: false,
  },
});
