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
    // FORM_FEEDBACK_V1 — le Proxy (src/proxy.ts) tronque par défaut tout corps de requête au-delà
    // de 10 Mo AVANT la Server Action ("Unexpected end of form" → error.tsx), ce qui court-circuitait
    // la validation applicative des documents (10 Mo, message local) et le plafond photo (12 Mo,
    // ADR-052). Aligné sur `bodySizeLimit` : le même plafond technique partout, la validation métier
    // reste seule à décider entre 10 et 13 Mo.
    proxyClientMaxBodySize: "13mb",
  },
};

export default nextConfig;
