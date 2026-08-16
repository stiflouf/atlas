import { afterAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";

// ADR-048 — recherche serveur : rechercherProspectsVendeurs(). Vérifie surtout que le filtrage par
// vue reste EXACTEMENT celui de listerProspectsVendeurs*() (même prédicat partagé, predicatVue —
// voir prospectVendeurRepository.ts) : "convertis" n'est pas retesté séparément ici, le prédicat
// est identique et déjà couvert par prospectVendeurRepository.test.ts sur les fonctions existantes.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { prospectsVendeurs: prospectsVendeursTable } = await import("@/db/schema");
const {
  creerProspectVendeur,
  marquerProspectVendeurPerdu,
  archiverProspectVendeur,
  rechercherProspectsVendeurs,
} = await import("./prospectVendeurRepository");

const NOM_PREFIX = "[test réel] ADR048-Prospect";
const idsCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `${NOM_PREFIX}%`));
});

async function prospectDeTest(suffixe: string, prenom = "Jean") {
  const prospect = await creerProspectVendeur({
    nom: `${NOM_PREFIX}-${suffixe}`,
    prenom,
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
  idsCrees.push(prospect.id);
  return prospect;
}

describe("rechercherProspectsVendeurs (ADR-048)", () => {
  it("vue='en_cours' exclut perdus et archivés — même règle que listerProspectsVendeurs()", async () => {
    const enCours = await prospectDeTest("EN-COURS");
    const perdu = await prospectDeTest("PERDU");
    await marquerProspectVendeurPerdu(perdu.id, "desaccord_estimation", "2026-01-15");
    const archive = await prospectDeTest("ARCHIVE");
    await archiverProspectVendeur(archive.id);

    const resultat = await rechercherProspectsVendeurs({ vue: "en_cours" });
    const ids = resultat.map((p) => p.id);
    expect(ids).toContain(enCours.id);
    expect(ids).not.toContain(perdu.id);
    expect(ids).not.toContain(archive.id);
  });

  it("vue='perdus' ne retourne que les prospects marqués perdus, non archivés", async () => {
    const perdu = await prospectDeTest("PERDU-VUE");
    await marquerProspectVendeurPerdu(perdu.id, "desaccord_estimation", "2026-01-15");

    const resultat = await rechercherProspectsVendeurs({ vue: "perdus" });
    expect(resultat.map((p) => p.id)).toContain(perdu.id);
  });

  it("vue='archives' ignore le statut sous-jacent — un prospect perdu ET archivé apparaît", async () => {
    const perduEtArchive = await prospectDeTest("PERDU-ARCHIVE");
    await marquerProspectVendeurPerdu(perduEtArchive.id, "desaccord_estimation", "2026-01-15");
    await archiverProspectVendeur(perduEtArchive.id);

    const resultat = await rechercherProspectsVendeurs({ vue: "archives" });
    expect(resultat.map((p) => p.id)).toContain(perduEtArchive.id);
  });

  it("recherche texte : trouve par nom ou par prénom, insensible à la casse, combinée à la vue", async () => {
    const prospect = await prospectDeTest("TEXTE-1", "Sylvie");

    const parNom = await rechercherProspectsVendeurs({ q: "texte-1", vue: "en_cours" });
    expect(parNom.map((p) => p.id)).toContain(prospect.id);

    const parPrenom = await rechercherProspectsVendeurs({ q: "SYLVIE", vue: "en_cours" });
    expect(parPrenom.map((p) => p.id)).toContain(prospect.id);

    const sansCorrespondance = await rechercherProspectsVendeurs({ q: "zzz-aucune-correspondance-zzz", vue: "en_cours" });
    expect(sansCorrespondance).toHaveLength(0);
  });

  it("ordre déterministe creeLe DESC puis id DESC — le dernier créé apparaît en premier", async () => {
    const nom = `${NOM_PREFIX}-ORDRE`;
    const premier = await prospectDeTest("ORDRE-1");
    await getDb().update(prospectsVendeursTable).set({ nom }).where(eq(prospectsVendeursTable.id, premier.id));
    const second = await prospectDeTest("ORDRE-2");
    await getDb().update(prospectsVendeursTable).set({ nom }).where(eq(prospectsVendeursTable.id, second.id));

    const resultat = await rechercherProspectsVendeurs({ q: "ORDRE", vue: "en_cours" });
    const index1 = resultat.findIndex((p) => p.id === premier.id);
    const index2 = resultat.findIndex((p) => p.id === second.id);
    expect(index2).toBeLessThan(index1);
  });
});
