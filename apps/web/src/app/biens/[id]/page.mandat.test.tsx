import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inArray, like } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-060 §1 (lot MANDATE_CANONICAL_UI_V1) — câblage RÉEL de la fiche Bien sur le mandat canonique :
// la page résout le workspace de session, tranche la précédence et rend le bloc Mandat. Cas qui
// piègent : canonique résilié + legacy « actif » (jamais « Actif » affiché pour le mandat),
// legacy-only (CTA Enregistrer), parties multiples.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: async () => "default",
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { biens: biensTable, contacts: contactsTable, mandats: mandatsTable, partiesMandat: partiesMandatTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerMandat, resilierMandat } = await import("@/lib/mandatRepository");
const { ajouterPartieMandat } = await import("@/lib/partieMandatRepository");
const FicheBien = (await import("./page")).default;

const REFERENCE_PREFIX = "[test réel] FICHE-BIEN-MANDAT";
const M = `Zfichemandat${Date.now()}`;
const idsBiens: string[] = [];
const idsContacts: string[] = [];

afterAll(async () => {
  if (idsBiens.length > 0) {
    const mandats = (await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens))).map((m) => m.id);
    if (mandats.length > 0) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, mandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
  }
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
  if (idsContacts.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
});

async function unBien(suffixe: string, statutMandat: "actif" | "suspendu" | "expire" = "actif") {
  const bien = await creerBien(
    {
      reference: `${REFERENCE_PREFIX}-${suffixe}-${Date.now()}`,
      titre: "Bien de test fiche mandat",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  return bien;
}

async function rendre(id: string, searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await FicheBien({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) }));
}

// Le bloc Mandat seul : ce que la section #mandat rend, sans le reste de la fiche.
function blocMandat(html: string): string {
  const debut = html.indexOf('<section id="mandat"');
  return html.slice(debut, html.indexOf("</section>", debut));
}

describe("/biens/[id] — bloc Mandat canonique", () => {
  it("canonique actif + legacy suspendu : mandat actuel exclusif, deux mandants, un représentant, historique ; jamais « Suspendu »", async () => {
    const bien = await unBien("CANONIQUE", "suspendu");
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-02-01", type: "exclusif", numero: "EX-9" });
    for (const [nom, role] of [["Mandant Un", "mandant"], ["Mandant Deux", "mandant"], ["Représentant", "representant"]] as const) {
      const c = await creerContact({ nom: `${M} ${nom}` }, WORKSPACE_TEST);
      idsContacts.push(c.id);
      await ajouterPartieMandat(mandat.id, { contactId: c.id, role }, WORKSPACE_TEST);
    }
    const html = await rendre(bien.id);
    const bloc = blocMandat(html);
    expect(bloc).toContain("Mandat actuel");
    expect(bloc).toContain("Exclusif");
    expect(bloc).toContain("EX-9");
    expect(bloc).toContain(`${M} Mandant Un`);
    expect(bloc).toContain(`${M} Mandant Deux`);
    expect(bloc).toContain(`${M} Représentant`);
    expect(bloc).toContain("Historique des mandats");
    expect(bloc).toContain("Modifier le mandat");
    expect(bloc).toContain("Résilier le mandat");
    expect(bloc).not.toContain("Enregistrer le mandat existant");
    expect(html).not.toContain("Suspendu");
    expect(html).toContain("Mandat depuis le 1 février 2026");
  });

  it("canonique résilié + legacy actif : « Aucun mandat en cours », historique Résilié, aucun « Actif » de mandat, aucun CTA legacy", async () => {
    const bien = await unBien("RESILIE", "actif");
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-10", type: "simple" });
    await resilierMandat(mandat.id, { resilieLe: "2026-03-01" }, WORKSPACE_TEST);
    const html = await rendre(bien.id);
    const bloc = blocMandat(html);
    expect(bloc).toContain("Aucun mandat en cours");
    expect(bloc).toContain("Résilié");
    expect(bloc).not.toContain("Mandat actuel");
    expect(bloc).not.toMatch(/>Actif</);
    expect(bloc).not.toContain("Enregistrer le mandat existant");
    expect(html).not.toContain("Mandat depuis le");
    // Le bloc « Vendeur & mandat » suit la même vérité.
    expect(html).not.toMatch(/Statut du mandat<\/p><span[^>]*>Actif</);
  });

  it("legacy-only : bloc legacy Actif + CTA Enregistrer le mandat existant, date préremplie", async () => {
    const bien = await unBien("LEGACY", "actif");
    const html = await rendre(bien.id);
    const bloc = blocMandat(html);
    expect(bloc).toContain("Enregistrer le mandat existant");
    expect(bloc).toContain('value="2026-01-01"');
    expect(bloc).not.toContain("Historique des mandats");
    expect(html).toContain("Mandat depuis le 1 janvier 2026");
    expect(html).toMatch(/Statut du mandat<\/p><span[^>]*>Actif</);
  });

  it("refus rapporté (?mandat=) affiché ; recherche de contact rendue avec candidats", async () => {
    const bien = await unBien("REFUS");
    await creerMandat({ bienId: bien.id, dateDebut: "2026-01-10", type: "simple" });
    const c = await creerContact({ nom: `${M} Candidat` }, WORKSPACE_TEST);
    idsContacts.push(c.id);
    const html = await rendre(bien.id, { mandat: "deja_partie", qMandat: `${M} Candidat` });
    const bloc = blocMandat(html);
    expect(bloc).toContain("déjà partie au mandat");
    expect(bloc).toContain("Ajouter comme mandant");
    expect(bloc).toContain(`${M} Candidat`);
  });
});
