import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq } from "drizzle-orm";

// Test d'intégration : terminerTacheAction ne doit JAMAIS enregistrer silencieusement une
// interaction (ADR-028, correction n° 2) — seule une soumission explicite
// (enregistrerInteraction=on) sur une tâche rattachée à un prospect vendeur déclenche l'écriture
// opt-in via le mécanisme ADR-027 (notes_prospect_vendeur + dernierContactLe). redirect() lève une
// erreur spéciale (digest NEXT_REDIRECT) même hors contexte de requête Next.js réel : on l'avale
// volontairement sur le chemin de succès, seul l'état de la base nous intéresse.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { taches: tachesTable, prospectsVendeurs: prospectsVendeursTable } = await import("@/db/schema");
const { creerTache, getTacheById } = await import("@/lib/tacheRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { listerNotesProspectVendeur } = await import("@/lib/noteProspectVendeurRepository");
const { terminerTacheAction } = await import("./terminerTache");

const idsTachesCrees: string[] = [];
const idsProspectsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsTachesCrees) {
    await getDb().delete(tachesTable).where(eq(tachesTable.id, id));
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

async function creerProspectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Terminer Tâche ${suffixe}`,
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
  });
  idsProspectsCrees.push(prospect.id);
  return prospect;
}

describe("terminerTacheAction", () => {
  it("refuse un id manquant", async () => {
    await expect(terminerTacheAction(formData({}))).rejects.toThrow(/[Ii]dentifiant/);
  });

  it("termine la tâche sans enregistrer d'interaction quand enregistrerInteraction est absent, même avec un prospect vendeur rattaché", async () => {
    const prospect = await creerProspectDeTest("001");
    const tache = await creerTache({
      titre: "[test] Tâche prospect sans interaction",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTachesCrees.push(tache.id);

    await terminerTacheAction(formData({ id: tache.id })).catch(() => {});

    const relue = await getTacheById(tache.id);
    expect(relue?.termineeLe).toBeDefined();
    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes).toEqual([]);
  });

  it("termine la tâche sans enregistrer d'interaction quand la tâche n'est pas rattachée à un prospect vendeur, même avec enregistrerInteraction=on", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche sans cible avec interaction demandée",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    await terminerTacheAction(
      formData({
        id: tache.id,
        enregistrerInteraction: "on",
        typeInteraction: "appel",
        contenuInteraction: "Contenu ignoré",
      })
    ).catch(() => {});

    const relue = await getTacheById(tache.id);
    expect(relue?.termineeLe).toBeDefined();
  });

  it("enregistre une vraie interaction (ADR-027) quand enregistrerInteraction=on sur une tâche rattachée à un prospect vendeur", async () => {
    const prospect = await creerProspectDeTest("002");
    const tache = await creerTache({
      titre: "[test] Tâche prospect avec interaction",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTachesCrees.push(tache.id);

    await terminerTacheAction(
      formData({
        id: tache.id,
        enregistrerInteraction: "on",
        typeInteraction: "appel",
        contenuInteraction: "Appel effectué, vendeur toujours intéressé.",
      })
    ).catch(() => {});

    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("appel");
    expect(notes[0].contenu).toBe("Appel effectué, vendeur toujours intéressé.");
  });

  it("rejette un type d'interaction invalide — la tâche reste terminée (écriture séquentielle assumée, voir terminerTache.ts), sans note créée", async () => {
    const prospect = await creerProspectDeTest("003");
    const tache = await creerTache({
      titre: "[test] Tâche type interaction invalide",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTachesCrees.push(tache.id);

    await expect(
      terminerTacheAction(
        formData({
          id: tache.id,
          enregistrerInteraction: "on",
          typeInteraction: "note_interne",
          contenuInteraction: "Contenu",
        })
      )
    ).rejects.toThrow(/[Tt]ype d'interaction/);

    const relue = await getTacheById(tache.id);
    expect(relue?.termineeLe).toBeDefined();
    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes).toEqual([]);
  });

  it("rejette un contenu d'interaction vide", async () => {
    const prospect = await creerProspectDeTest("004");
    const tache = await creerTache({
      titre: "[test] Tâche contenu interaction vide",
      type: "appel",
      priorite: "normale",
      origine: "manuelle",
      cible: { type: "prospectVendeur", id: prospect.id },
    });
    idsTachesCrees.push(tache.id);

    await expect(
      terminerTacheAction(
        formData({ id: tache.id, enregistrerInteraction: "on", typeInteraction: "appel", contenuInteraction: "   " })
      )
    ).rejects.toThrow(/vide/);

    const relue = await getTacheById(tache.id);
    expect(relue?.termineeLe).toBeDefined();
  });
});
