import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import BienHero from "./BienHero";

function bienTest(surcharge: Partial<Bien> = {}): Bien {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    reference: "AXB-1042",
    titre: "Bel appartement",
    type: "appartement",
    adresse: "12 rue des Lilas",
    ville: "Lyon",
    codePostal: "69006",
    surface: 82,
    pieces: 4,
    prix: 485000,
    statutMandat: "actif",
    dateMandat: "2026-03-12",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

describe("BienHero", () => {
  it("affiche la vraie photo principale (via l'API ADR-052) quand photoPrincipaleId est fourni, jamais un chemin de stockage", () => {
    const html = renderToStaticMarkup(
      <BienHero
        bien={bienTest()}
        photoPrincipaleId="photo-1"
        nombrePhotos={3}
        statutCommercialLabel="En commercialisation"
        statutCommercialVariant="default"
      />
    );
    expect(html).toContain("/api/photos-bien/photo-1");
    expect(html).not.toContain("cle_stockage");
  });

  it("bascule sur le fallback de marque (PropertyVisual) quand aucune photo n'existe", () => {
    const html = renderToStaticMarkup(
      <BienHero
        bien={bienTest()}
        photoPrincipaleId={undefined}
        nombrePhotos={0}
        statutCommercialLabel="En commercialisation"
        statutCommercialVariant="default"
      />
    );
    expect(html).not.toContain("/api/photos-bien/");
    expect(html).toContain("Visuel DOMIORA");
  });

  it("affiche le lien Gérer les photos pour un bien réel (id UUID)", () => {
    const html = renderToStaticMarkup(
      <BienHero
        bien={bienTest()}
        photoPrincipaleId={undefined}
        nombrePhotos={0}
        statutCommercialLabel="En commercialisation"
        statutCommercialVariant="default"
      />
    );
    expect(html).toContain("Gérer les photos");
    expect(html).toContain('href="/biens/550e8400-e29b-41d4-a716-446655440000/photos"');
  });

  it("masque le lien Gérer les photos pour un bien mocké (id non-UUID)", () => {
    const html = renderToStaticMarkup(
      <BienHero
        bien={bienTest({ id: "bien-001" })}
        photoPrincipaleId={undefined}
        nombrePhotos={0}
        statutCommercialLabel="En commercialisation"
        statutCommercialVariant="default"
      />
    );
    expect(html).not.toContain("Gérer les photos");
  });

  it("n'affiche le compteur de photos que s'il y a plus d'une photo", () => {
    // Une seule photo -> un seul lien vers /biens/{id}/photos (le bouton "Gérer les photos").
    const sansCompteur = renderToStaticMarkup(
      <BienHero
        bien={bienTest()}
        photoPrincipaleId="photo-1"
        nombrePhotos={1}
        statutCommercialLabel="En commercialisation"
        statutCommercialVariant="default"
      />
    );
    const lienPhotos = /href="\/biens\/[^"]+\/photos"/g;
    expect(sansCompteur.match(lienPhotos)?.length).toBe(1);

    // Plusieurs photos -> deux liens (Gérer les photos + pastille galerie), avec le compte réel.
    const avecCompteur = renderToStaticMarkup(
      <BienHero
        bien={bienTest()}
        photoPrincipaleId="photo-1"
        nombrePhotos={6}
        statutCommercialLabel="En commercialisation"
        statutCommercialVariant="default"
      />
    );
    expect(avecCompteur.match(lienPhotos)?.length).toBe(2);
    expect(avecCompteur).toContain("6 photos");
  });

  it("affiche l'adresse, la référence, le prix et le statut réels du bien — aucune donnée inventée", () => {
    const html = renderToStaticMarkup(
      <BienHero
        bien={bienTest()}
        photoPrincipaleId={undefined}
        nombrePhotos={0}
        statutCommercialLabel="Offre en cours"
        statutCommercialVariant="accent"
      />
    );
    expect(html).toContain("12 rue des Lilas");
    expect(html).toContain("69006");
    expect(html).toContain("Lyon");
    expect(html).toContain("AXB-1042");
    expect(html).toContain("485");
    expect(html).toContain("Offre en cours");
  });
});
