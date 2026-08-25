import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Plafond global (toutes les Server Actions de l'app, pas de scope par action — ADR-052) :
      // le plus grand des deux besoins actuels, photos de bien (12 Mo/photo, voir
      // src/actions/ajouterPhotoBien.ts) + marge multipart. documents_bien garde sa propre
      // validation applicative à 10 Mo (src/actions/ajouterDocumentBien.ts) : ce relèvement ne
      // change donc pas sa limite métier, seulement le plafond technique commun.
      bodySizeLimit: "13mb",
    },
  },
};

export default nextConfig;
