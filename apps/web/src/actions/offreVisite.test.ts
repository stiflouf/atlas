import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));
import { eq } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// Test d'intégration + garde-fous : lierVisiteAOffreAction/delierVisiteAction doivent refuser
// explicitement (throw) sur une correspondance bien/acquéreur invalide, une date incohérente ou
// un doublon, et delierVisiteAction doit retrouver le bien à partir du lienId côté serveur
// (jamais d'un bienId fourni par le formulaire) — même style que offre.test.ts/compromis.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  comptesRendusVisite: comptesRendusVisiteTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre } = await import("@/lib/offreRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { listerLiensPourBien, lierVisiteAOffre } = await import("@/lib/offreVisiteRepository");
const { lierVisiteAOffreAction, delierVisiteAction } = await import("./offreVisite");

const idsOffresCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsOffresCrees) {
    await getDb().delete(offresTable).where(eq(offresTable.id, id));
  }
  for (const id of idsComptesRendusCrees) {
    await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerJeuDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] OFFRE-VISITE-ACTION-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  }, WORKSPACE_TEST);
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Offre Visite Action ${suffixe}`,
    email: `test-réel-offre-visite-action-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "offre",
    notes: "",
    datePremiereContact: "2026-01-01",
  }, WORKSPACE_TEST);
  idsAcquereursCrees.push(acquereur.id);
  const offre = await enregistrerOffre({
    bienId: bien.id,
    acquereurId: acquereur.id,
    montant: 300000,
    dateOffre: "2026-08-10",
  });
  idsOffresCrees.push(offre.id);
  const compteRendu = await enregistrerCompteRenduVisite({
    bienId: bien.id,
    acquereurId: acquereur.id,
    dateVisite: "2026-08-01",
    retour: "Retour de test.",
    interet: "interesse",
  });
  idsComptesRendusCrees.push(compteRendu.id);
  return { bien, acquereur, offre, compteRendu };
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("lierVisiteAOffreAction — garde-fous", () => {
  it("crée le lien pour une visite valide (même bien/acquéreur, antérieure à l'offre)", async () => {
    const { bien, offre, compteRendu } = await creerJeuDeTest("VALIDE");

    await lierVisiteAOffreAction(ETAT_FORMULAIRE_INITIAL,
      formData({ offreId: offre.id, compteRenduVisiteId: compteRendu.id })
    ).catch(() => {});

    const liens = await listerLiensPourBien(bien.id);
    expect(liens.map((l) => l.visite.id)).toEqual([compteRendu.id]);
  });

  it("refuse explicitement (throw) une offre introuvable", async () => {
    const { compteRendu } = await creerJeuDeTest("OFFRE-INTROUVABLE");

    await expect(
      lierVisiteAOffreAction(ETAT_FORMULAIRE_INITIAL,
        formData({ offreId: "00000000-0000-0000-0000-000000000000", compteRenduVisiteId: compteRendu.id })
      )
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/Offre introuvable/) });
  });

  it("refuse explicitement (throw) une visite qui ne concerne pas le même bien", async () => {
    const { offre } = await creerJeuDeTest("AUTRE-BIEN-A");
    const { compteRendu: compteRenduAutreBien } = await creerJeuDeTest("AUTRE-BIEN-B");

    await expect(
      lierVisiteAOffreAction(ETAT_FORMULAIRE_INITIAL, formData({ offreId: offre.id, compteRenduVisiteId: compteRenduAutreBien.id }))
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/ce bien/) });
  });

  it("refuse explicitement (throw) une visite postérieure à l'offre", async () => {
    const { bien, acquereur, offre } = await creerJeuDeTest("DATE-INVALIDE");
    const compteRenduTardif = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-20",
      retour: "Retour de test.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(compteRenduTardif.id);

    await expect(
      lierVisiteAOffreAction(ETAT_FORMULAIRE_INITIAL, formData({ offreId: offre.id, compteRenduVisiteId: compteRenduTardif.id }))
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/postérieure/) });
  });

  it("refuse explicitement (throw) une paire déjà liée", async () => {
    const { offre, compteRendu } = await creerJeuDeTest("DOUBLON");
    await lierVisiteAOffre(offre.id, compteRendu.id);

    await expect(
      lierVisiteAOffreAction(ETAT_FORMULAIRE_INITIAL, formData({ offreId: offre.id, compteRenduVisiteId: compteRendu.id }))
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/déjà liée/) });
  });
});

describe("delierVisiteAction — retrouve le bien côté serveur, jamais depuis le formulaire", () => {
  it("supprime le lien attendu sans toucher à l'offre ni au compte rendu", async () => {
    const { bien, offre, compteRendu } = await creerJeuDeTest("RETRAIT");
    const lien = await lierVisiteAOffre(offre.id, compteRendu.id);

    await delierVisiteAction(ETAT_FORMULAIRE_INITIAL, formData({ lienId: lien.id })).catch(() => {});

    await expect(listerLiensPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) un lienId introuvable", async () => {
    await expect(
      delierVisiteAction(ETAT_FORMULAIRE_INITIAL, formData({ lienId: "00000000-0000-0000-0000-000000000000" }))
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/Lien introuvable/) });
  });
});
