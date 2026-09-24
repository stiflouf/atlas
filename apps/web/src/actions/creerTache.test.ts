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

// Test d'intégration + garde-fou : creerTacheAction doit refuser explicitement (throw) toute
// association à un bien, un acquéreur ou un prospect vendeur archivé (ADR-012/027/028), ainsi que
// toute tentative de renseigner plus d'une cible à la fois (miroir du CHECK
// taches_une_seule_cible_check, schema.ts).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  prospectsVendeurs: prospectsVendeursTable,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur, archiverProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerTacheAction } = await import("./creerTache");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsProspectsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(tachesTable).where(eq(tachesTable.titre, "[test réel] Tâche sur entité archivée"));
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
  for (const id of idsProspectsCrees) {
    await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  }
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("creerTacheAction — garde-fou entité archivée", () => {
  it("refuse explicitement (throw) une tâche associée à un bien archivé", async () => {
    const bien = await creerBien({
      reference: "[test réel] TACHE-BIEN-ARCHIVE",
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
    await archiverBien(bien.id, WORKSPACE_TEST);

    await expect(
      creerTacheAction(ETAT_FORMULAIRE_INITIAL,
        formData({
          titre: "[test réel] Tâche sur entité archivée",
          type: "autre",
          priorite: "normale",
          bienId: bien.id,
        })
      )
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/bien archivé/) });
  });

  it("refuse explicitement (throw) une tâche associée à un acquéreur archivé", async () => {
    const acquereur = await creerAcquereur({
      prenom: "Test",
      nom: "[test réel] Tâche Archive",
      email: "test-réel-tache-archive@example.com",
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    }, WORKSPACE_TEST);
    idsAcquereursCrees.push(acquereur.id);
    await archiverAcquereur(acquereur.id, WORKSPACE_TEST);

    await expect(
      creerTacheAction(ETAT_FORMULAIRE_INITIAL,
        formData({
          titre: "[test réel] Tâche sur entité archivée",
          type: "autre",
          priorite: "normale",
          acquereurId: acquereur.id,
        })
      )
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/acquéreur archivé/) });
  });

  it("refuse explicitement (throw) une tâche associée à un prospect vendeur archivé", async () => {
    const prospect = await creerProspectVendeur({
      nom: "[test réel] Tâche Prospect Archive",
      prenom: undefined,
      email: undefined,
      telephone: undefined,
      origineLead: undefined,
      origineLeadDetail: undefined,
      adresseBienPotentiel: undefined,
      secteurBienPotentiel: undefined,
      ville: undefined,
      codePostal: undefined,
      typeBien: undefined,
    }, WORKSPACE_TEST);
    idsProspectsCrees.push(prospect.id);
    await archiverProspectVendeur(prospect.id);

    await expect(
      creerTacheAction(ETAT_FORMULAIRE_INITIAL,
        formData({
          titre: "[test réel] Tâche sur entité archivée",
          type: "autre",
          priorite: "normale",
          prospectVendeurId: prospect.id,
        })
      )
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/prospect vendeur archivé/) });
  });

  it("refuse explicitement (throw) plus d'une cible à la fois", async () => {
    const bien = await creerBien({
      reference: "[test réel] TACHE-DEUX-CIBLES",
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
      nom: "[test réel] Tâche Deux Cibles",
      email: "test-réel-tache-deux-cibles@example.com",
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    }, WORKSPACE_TEST);
    idsAcquereursCrees.push(acquereur.id);

    await expect(
      creerTacheAction(ETAT_FORMULAIRE_INITIAL,
        formData({
          titre: "[test réel] Tâche sur entité archivée",
          type: "autre",
          priorite: "normale",
          bienId: bien.id,
          acquereurId: acquereur.id,
        })
      )
    ).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/une seule cible/) });
  });

  it("refuse un titre vide", async () => {
    await expect(creerTacheAction(ETAT_FORMULAIRE_INITIAL, formData({ titre: "  ", type: "autre", priorite: "normale" }))).resolves.toMatchObject({ statut: "erreur", message: expect.stringMatching(/[Tt]itre/) });
  });
});
