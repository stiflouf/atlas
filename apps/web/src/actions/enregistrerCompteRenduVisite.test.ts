import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { and, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Test d'intégration + garde-fou : vérifie qu'un appel direct à enregistrerCompteRenduVisiteAction
// (contournant le formulaire, remplacé par un message sur une fiche archivée — voir
// visites/[id]/preparer/page.tsx) n'insère jamais de compte rendu si le bien OU l'acquéreur est
// archivé. Même principe que ajouterNoteBien.test.ts pour redirect().
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  evenementsMetier,
  executionsAutomatisation,
  comptesRendusVisite,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien, archiverBien, desarchiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { listerComptesRendusPourBien } = await import("@/lib/compteRenduVisiteRepository");
const { enregistrerCompteRenduVisiteAction } = await import("./enregistrerCompteRenduVisite");
const { materialiserVisite, getVisiteById } = await import("@/lib/visiteRepository");
const { definirActivationAutomatisation } = await import("@/lib/automatisations/configurationAutomatisationRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  // evenements_metier/executions_automatisation référencent comptes_rendus_visite/taches en
  // NO ACTION (append-only, ADR-032) — doivent être purgés AVANT la suppression cascade des
  // biens/acquéreurs, sinon la contrainte FK bloque le DELETE (même patron que
  // catalogueRegles.nouveauMatch.test.ts).
  if (idsBiensCrees.length > 0) {
    const comptesRendus = await getDb()
      .select({ id: comptesRendusVisite.id })
      .from(comptesRendusVisite)
      .where(inArray(comptesRendusVisite.bienId, idsBiensCrees));
    const idsComptesRendus = comptesRendus.map((c) => c.id);
    if (idsComptesRendus.length > 0) {
      const evenements = await getDb()
        .select({ id: evenementsMetier.id })
        .from(evenementsMetier)
        .where(inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus));
      const idsEvenements = evenements.map((e) => e.id);
      if (idsEvenements.length > 0) {
        await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
        await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
      }
    }
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

async function creerBienTest(reference: string) {
  const bien = await creerBien({
    reference,
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
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurTest(nom: string) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom,
    email: "test-réel@example.com",
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

describe("enregistrerCompteRenduVisiteAction — garde-fou entité archivée", () => {
  it("n'insère aucun compte rendu si le bien est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBienTest("[test réel] CR-BIEN-ARCHIVE");
    const acquereur = await creerAcquereurTest("[test réel] CR-ACQ-1");
    await archiverBien(bien.id);

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        dateVisite: "2026-08-01",
        retour: "Tentative sur bien archivé",
        interet: "interesse",
      })
    ).catch(() => {});

    expect(await listerComptesRendusPourBien(bien.id)).toEqual([]);
  });

  it("n'insère aucun compte rendu si l'acquéreur est archivé, même en appelant l'action directement", async () => {
    const bien = await creerBienTest("[test réel] CR-BIEN-2");
    const acquereur = await creerAcquereurTest("[test réel] CR-ACQ-ARCHIVE");
    await archiverAcquereur(acquereur.id);
    // S'assurer que seul l'acquéreur est archivé pour ce cas (le bien précédent avait été
    // archivé dans le test ci-dessus, celui-ci est un nouveau bien actif).
    await desarchiverBien(bien.id);

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        dateVisite: "2026-08-01",
        retour: "Tentative sur acquéreur archivé",
        interet: "interesse",
      })
    ).catch(() => {});

    expect(await listerComptesRendusPourBien(bien.id)).toEqual([]);
  });
});

// VALUE-02 — destination après enregistrement. Test structurel sur le source, même patron que
// BienTabs.onglet.test.ts : ce qui compte est la DESTINATION, pas le rendu ; la vérifier par
// lecture du fichier évite de simuler tout le cycle Next pour un contrôle d'URL.
describe("enregistrerCompteRenduVisiteAction — destination après succès (VALUE-02)", () => {
  const source = readFileSync(join(__dirname, "enregistrerCompteRenduVisite.ts"), "utf8");

  it("ramène sur la fiche de la visite traitée, jamais sur la fiche du bien quand une visite existe", () => {
    expect(source).toContain("redirect(`/visites/${visiteValide.id}`)");
  });

  it("conserve le repli sur le bien quand aucune visite Atlas n'a pu être reliée", () => {
    expect(source).toContain("redirect(`/biens/${bienId}`)");
  });
});

describe("enregistrerCompteRenduVisiteAction — transition visite → realisee (ADR-040)", () => {
  it("compte rendu sur une visite planifiee : la visite passe realisee, l'événement visite_realisee est émis une seule fois", async () => {
    const bien = await creerBienTest("[test réel] CR-VISITE-1");
    const acquereur = await creerAcquereurTest("[test réel] CR-VISITE-ACQ-1");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-08-01",
      rendezVousCalendarId: `gcal-cr-${bien.id}`,
    });

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: visite.id,
        dateVisite: "2026-08-01",
        retour: "Visite très positive",
        interet: "interesse",
      })
    ).catch(() => {});

    expect((await getVisiteById(visite.id))?.statut).toBe("realisee");

    const [compteRendu] = await listerComptesRendusPourBien(bien.id);
    expect(compteRendu.visiteId).toBe(visite.id);
    // interet reste uniquement sur le compte rendu — jamais dupliqué sur la visite (§15 ADR-040).
    expect(compteRendu.interet).toBe("interesse");

    const evenements = await getDb()
      .select()
      .from(evenementsMetier)
      .where(and(eq(evenementsMetier.typeEvenement, "visite_realisee"), eq(evenementsMetier.compteRenduVisiteId, compteRendu.id)));
    expect(evenements).toHaveLength(1);
  });

  it("règle suivi_apres_visite non régressée (ADR-041 : cible désormais l'acquéreur, jamais le compte rendu)", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);
    const bien = await creerBienTest("[test réel] CR-VISITE-2");
    const acquereur = await creerAcquereurTest("[test réel] CR-VISITE-ACQ-2");
    const visite = await materialiserVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      datePrevue: "2026-08-01",
      rendezVousCalendarId: `gcal-cr-${bien.id}`,
    });

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: visite.id,
        dateVisite: "2026-08-01",
        retour: "À suivre",
        interet: "a_reflechir",
      })
    ).catch(() => {});

    const tachesDeSuivi = await getDb()
      .select()
      .from(tachesTable)
      .where(eq(tachesTable.acquereurId, acquereur.id));
    expect(tachesDeSuivi).toHaveLength(1);
    expect(tachesDeSuivi[0].visiteId).toBeNull(); // jamais posée par cette règle depuis ADR-041
    expect(tachesDeSuivi[0].titre).toBe(`Relancer ${acquereur.prenom} ${acquereur.nom} après la visite de ${bien.reference}`);

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });

  it("visiteId absent (page non ADR-040, ou visite non matérialisable) : compte rendu enregistré normalement, sans erreur", async () => {
    const bien = await creerBienTest("[test réel] CR-SANS-VISITE-1");
    const acquereur = await creerAcquereurTest("[test réel] CR-SANS-VISITE-ACQ-1");

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        dateVisite: "2026-08-01",
        retour: "Sans visite Atlas associée",
        interet: "inconnu",
      })
    ).catch(() => {});

    const [compteRendu] = await listerComptesRendusPourBien(bien.id);
    expect(compteRendu).toBeDefined();
    expect(compteRendu.visiteId).toBeUndefined();
  });

  it("visiteId soumis mais pointant vers un autre couple bien/acquéreur : ignoré, aucune transition, compte rendu quand même enregistré", async () => {
    const bien = await creerBienTest("[test réel] CR-VISITE-MISMATCH-1");
    const acquereur = await creerAcquereurTest("[test réel] CR-VISITE-MISMATCH-ACQ-1");
    const autreBien = await creerBienTest("[test réel] CR-VISITE-MISMATCH-AUTRE");
    const autreAcquereur = await creerAcquereurTest("[test réel] CR-VISITE-MISMATCH-AUTRE-ACQ");
    const visiteAutrePaire = await materialiserVisite({
      bienId: autreBien.id,
      acquereurId: autreAcquereur.id,
      datePrevue: "2026-08-01",
      rendezVousCalendarId: `gcal-mismatch-${bien.id}`,
    });

    await enregistrerCompteRenduVisiteAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: visiteAutrePaire.id,
        dateVisite: "2026-08-01",
        retour: "Tentative de contournement",
        interet: "inconnu",
      })
    ).catch(() => {});

    expect((await getVisiteById(visiteAutrePaire.id))?.statut).toBe("planifiee");
    const [compteRendu] = await listerComptesRendusPourBien(bien.id);
    expect(compteRendu.visiteId).toBeUndefined();
  });
});
