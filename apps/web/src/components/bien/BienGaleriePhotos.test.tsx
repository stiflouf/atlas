import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BienGaleriePhotos from "./BienGaleriePhotos";

describe("BienGaleriePhotos", () => {
  it("affiche une vignette par vraie photo (via l'API ADR-052), jamais un chemin de stockage", () => {
    const html = renderToStaticMarkup(
      <BienGaleriePhotos bienId="550e8400-e29b-41d4-a716-446655440000" photoIds={["photo-1", "photo-2", "photo-3"]} />
    );
    expect(html).toContain("/api/photos-bien/photo-1");
    expect(html).toContain("/api/photos-bien/photo-2");
    expect(html).toContain("/api/photos-bien/photo-3");
    expect(html).not.toContain("cle_stockage");
  });

  it("respecte l'ordre reçu (déjà l'ordre déterministe ADR-052) — la première vignette est marquée Principale", () => {
    const html = renderToStaticMarkup(<BienGaleriePhotos bienId="bien-1" photoIds={["photo-1", "photo-2"]} />);
    const indexPhoto1 = html.indexOf("/api/photos-bien/photo-1");
    const indexPhoto2 = html.indexOf("/api/photos-bien/photo-2");
    const indexPrincipale = html.indexOf("Principale");
    expect(indexPhoto1).toBeLessThan(indexPhoto2);
    expect(indexPrincipale).toBeGreaterThan(-1);
    expect(indexPrincipale).toBeLessThan(indexPhoto2);
  });

  it("chaque vignette et la tuile finale renvoient vers la page de gestion des photos existante", () => {
    const html = renderToStaticMarkup(<BienGaleriePhotos bienId="bien-42" photoIds={["photo-1", "photo-2"]} />);
    const lienGestion = /href="\/biens\/bien-42\/photos"/g;
    expect(html.match(lienGestion)?.length).toBe(3);
    expect(html).toContain("Gérer les photos");
  });
});
