import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// BON_VISITE_V2_VISIT_LIFECYCLE_CORRECTION — surface de signature : le texte et la formule de
// consentement affichés doivent être EXACTEMENT ceux figés dans le snapshot (T3/T4/T5), le parcours
// doit rester ouvert sur une visite seulement PLANIFIÉE (T1), et seule une visite ANNULÉE le bloque.
// Même patron d'intégration réelle que page.bonVisite.test.tsx.
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
const { creerBonVisite, signerBonVisite, getBonVisiteById } = await import("@/lib/bonVisiteRepository");
const { annulerVisite } = await import("@/lib/visiteRepository");
const { TEXTE_CONSENTEMENT_BON_VISITE_V2, VERSION_TEMPLATE_BON_VISITE_V1 } = await import(
  "@/lib/bonVisite/templateBonVisite"
);
const PageSignature = (await import("./page")).default;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];

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

async function pngSignatureFactice(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } })
    .png()
    .toBuffer();
}

// `planifiee` par défaut : l'état nominal du terrain.
async function visiteDeTest(suffixe: string, { realisee = false }: { realisee?: boolean } = {}) {
  const bien = await creerBien(
    {
      reference: `[test réel] SIGN-PAGE-${suffixe}`,
      titre: `Bien signature ${suffixe}`,
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
      nom: `[test réel] Signature page ${suffixe}`,
      email: `test-sign-page-${suffixe}@example.com`,
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
  if (realisee) {
    await getDb()
      .update(visitesTable)
      .set({ statut: "realisee", realiseeLe: new Date("2026-09-12T08:15:00Z") })
      .where(eq(visitesTable.id, resultat.visite.id));
  }
  return { bien, visite: resultat.visite };
}

async function rendu(visiteId: string, bonId: string) {
  return renderToStaticMarkup(
    await PageSignature({
      params: Promise.resolve({ id: visiteId, bonId }),
      searchParams: Promise.resolve({}),
    })
  );
}

describe("Page de signature — consentement affiché (T5)", () => {
  it("affiche la formule de consentement EXACTE du snapshot, et le texte daté du bon", async () => {
    const { visite } = await visiteDeTest("CONSENT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const html = await rendu(visite.id, r.bonVisite.id);
    // La chaîne est rendue telle quelle (apostrophes typographiques échappées par React) : on
    // vérifie chaque mot de la formule plutôt qu'un littéral ré-encodé à la main.
    for (const mot of TEXTE_CONSENTEMENT_BON_VISITE_V2.split(" ")) {
      expect(html).toContain(mot.replace(/'/g, "&#x27;"));
    }
    expect(html).toContain("a été visité avec le concours de");
    expect(html).toContain("Signer le bon de visite");
  });

  it("un brouillon domiora-v1 affiche sa formule d'origine, jamais celle de V2", async () => {
    const { visite } = await visiteDeTest("CONSENTV1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await getDb()
      .update(bonsVisiteTable)
      .set({
        templateVersion: VERSION_TEMPLATE_BON_VISITE_V1,
        contenuSnapshot: {
          visite: { id: visite.id, datePrevue: "2026-09-10" },
          bien: r.bonVisite.contenuSnapshot.bien,
          conseiller: r.bonVisite.contenuSnapshot.conseiller,
          template: { version: VERSION_TEMPLATE_BON_VISITE_V1, texte: "Bon de visite\n\nTexte historique." },
        },
      })
      .where(eq(bonsVisiteTable.id, r.bonVisite.id));

    const html = await rendu(visite.id, r.bonVisite.id);
    expect(html).toContain("je le signe volontairement");
    expect(html).not.toContain("appose volontairement ma signature");
    expect(html).toContain("Texte historique.");
  });
});

describe("Page de signature — parcours ouvert sur une visite planifiée (T1)", () => {
  it("une visite seulement planifiée affiche le formulaire de signature", async () => {
    const { visite } = await visiteDeTest("PLANIFIEE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const html = await rendu(visite.id, r.bonVisite.id);
    expect(html).toContain("Signer le bon de visite");
    expect(html).not.toContain("Signature indisponible");
    // Aucune date de visite affirmée, et surtout pas la date prévue.
    expect(html).not.toContain("10 septembre 2026");
    expect(html).toContain("a été visité avec le concours de");
  });
});

describe("Page de signature — visite annulée (T9)", () => {
  it("remplace le formulaire par un message explicite, sans bouton de signature", async () => {
    const { visite } = await visiteDeTest("ANNULEE1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await annulerVisite(visite.id, WORKSPACE_TEST);

    const html = await rendu(visite.id, r.bonVisite.id);
    expect(html).toContain("Signature indisponible");
    expect(html).toContain("visite annulée");
    expect(html).not.toContain("Signer le bon de visite");
    // L'abandon du brouillon reste possible — le blocage ne piège pas le conseiller.
    expect(html).toContain("Annuler ce brouillon");
  });
});

describe("Page de signature — texte affiché = texte signé (T3/T4)", () => {
  it("le texte affiché avant signature est exactement celui figé par la signature", async () => {
    const { visite } = await visiteDeTest("TEXTEIDENT1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");

    const htmlAvant = await rendu(visite.id, r.bonVisite.id);

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

    const relu = await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST);
    // Chaque ligne du texte figé était déjà présente, telle quelle, dans la page affichée.
    for (const ligne of relu!.contenuSnapshot.template.texte.split("\n").filter(Boolean)) {
      expect(htmlAvant).toContain(ligne.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;"));
    }
  });

  // Une réalisation survenant APRÈS la préparation ne réécrit jamais le texte déjà présenté.
  it("une réalisation postérieure à la préparation ne change pas le texte affiché", async () => {
    const { visite } = await visiteDeTest("REALISEEAPRES1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const htmlAvant = await rendu(visite.id, r.bonVisite.id);

    await getDb()
      .update(visitesTable)
      .set({ statut: "realisee", realiseeLe: new Date("2026-09-12T08:15:00Z") })
      .where(eq(visitesTable.id, visite.id));

    const htmlApres = await rendu(visite.id, r.bonVisite.id);
    expect(htmlApres).toBe(htmlAvant);
    expect(htmlApres).not.toContain("12 septembre 2026");
  });
});
