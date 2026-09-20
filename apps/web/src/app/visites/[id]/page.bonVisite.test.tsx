import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray, or } from "drizzle-orm";
import sharp from "sharp";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// §25/§58 du brief VISIT_SIGNED_FORM_V1 — section "Bon de visite" de la fiche Visite : les 4 états
// (aucun bon / brouillon / signé / annulé), même patron d'intégration réelle que page.test.tsx.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: async () => "default",
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  bonsVisite: bonsVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerVisite } = await import("@/lib/visiteRepository");
const { creerBonVisite, annulerBrouillonBonVisite, signerBonVisite } = await import("@/lib/bonVisiteRepository");
const VisitePage = (await import("./page")).default;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];

async function pngSignatureFactice(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } })
    .png()
    .toBuffer();
}

afterAll(async () => {
  const bonsCrees = idsVisites.length
    ? await getDb().select({ id: bonsVisiteTable.id }).from(bonsVisiteTable).where(inArray(bonsVisiteTable.visiteId, idsVisites))
    : [];
  const idsBons = bonsCrees.map((b) => b.id);
  if (idsVisites.length || idsBons.length) {
    const filtre = or(
      idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
      idsBons.length ? inArray(evenementsMetier.bonVisiteId, idsBons) : undefined
    );
    const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
    }
  }
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function visiteDeTest(suffixe: string) {
  const bien = await creerBien(
    {
      reference: `[test réel] FICHE-BON-${suffixe}`,
      titre: `Bien fiche bon ${suffixe}`,
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `[test réel] Fiche bon ${suffixe}`,
      email: `test-fiche-bon-${suffixe}@example.com`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(acquereur.id);
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-10" }, WORKSPACE_TEST);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  return { bien, acquereur, visite: resultat.visite };
}

describe("Fiche Visite — section Bon de visite (§25/§58)", () => {
  it("état A : aucun bon → bouton de création", async () => {
    const { visite } = await visiteDeTest("A1");
    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Bon de visite");
    expect(html).toContain("Créer le bon de visite");
  });

  it("état B : brouillon → lien Ouvrir / faire signer", async () => {
    const { visite } = await visiteDeTest("B1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Brouillon");
    expect(html).toContain(`href="/visites/${visite.id}/bon-de-visite/${r.bonVisite.id}"`);
    expect(html).toContain("Ouvrir / faire signer");
  });

  it("état C : signé → lien de téléchargement", async () => {
    const { visite } = await visiteDeTest("C1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const signature = await signerBonVisite(
      {
        bonVisiteId: r.bonVisite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImagePng: await pngSignatureFactice(),
        consentementConfirme: true,
      },
      WORKSPACE_TEST
    );
    expect(signature.statut).toBe("signe");

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Signé");
    expect(html).toContain(`href="/api/bons-visite/${r.bonVisite.id}/document"`);
    expect(html).toContain("Télécharger le document signé");
  });

  it("état D : annulé → possibilité de créer un nouveau bon", async () => {
    const { visite } = await visiteDeTest("D1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await annulerBrouillonBonVisite(r.bonVisite.id, WORKSPACE_TEST);

    const html = renderToStaticMarkup(await VisitePage({ params: Promise.resolve({ id: visite.id }) }));
    expect(html).toContain("Annulé");
    expect(html).toContain("Créer un nouveau bon");
  });
});
