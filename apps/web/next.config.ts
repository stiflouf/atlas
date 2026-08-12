import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Fichiers jusqu'à 10 Mo (limite applicative, voir src/actions/ajouterDocumentBien.ts) +
      // marge pour l'overhead multipart/form-data (boundaries, en-têtes de champs).
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
