import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-036) : vraie base Postgres. Le dry-run n'écrit jamais — ses
// assertions restent donc valables quel que soit le contenu réel de la base partagée. `apply`
// touche par nature TOUT le système (c'est son rôle) : les assertions sur son effet restent donc
// scopées à la paire créée par ce fichier, jamais un comptage global qui dépendrait du contenu
// d'autres suites/données de développement déjà présentes.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, compatibilitesBienAcquereurEtat, evenementsMetier } =
  await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { calculerBaselineDryRun, appliquerBaseline } = await import("./baseline");
const { ecrireEtatPaire } = await import("./etatRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

// appliquerBaseline() touche par nature TOUTES les paires du système, pas seulement celles créées
// ici (biens de test × acquéreurs pré-existants, et réciproquement) — même raisonnement que
// synchronisation.test.ts : purge par bien OU acquéreur créé ici, jamais un seul côté.
afterAll(async () => {
  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0) {
    await getDb()
      .delete(evenementsMetier)
      .where(or(inArray(evenementsMetier.bienId, idsBiensCrees), inArray(evenementsMetier.acquereurId, idsAcquereursCrees)));
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(
        or(
          inArray(compatibilitesBienAcquereurEtat.bienId, idsBiensCrees),
          inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereursCrees)
        )
      );
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string, prix = 300000) {
  const bien = await creerBien({
    reference: `[test réel] BASELINE-${suffixe}`,
    titre: "Bien de test baseline",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, budgetMax = 400000) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Baseline ${suffixe}`,
    email: `test-réel-baseline-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

async function lireEtat(bienId: string, acquereurId: string) {
  const [ligne] = await getDb()
    .select()
    .from(compatibilitesBienAcquereurEtat)
    .where(and(eq(compatibilitesBienAcquereurEtat.bienId, bienId), eq(compatibilitesBienAcquereurEtat.acquereurId, acquereurId)));
  return ligne;
}

describe("calculerBaselineDryRun — jamais d'écriture", () => {
  it("évaluations, comptages cohérents, 0 événement, 0 état écrit", async () => {
    const rapport = await calculerBaselineDryRun();
    expect(rapport.mode).toBe("dry-run");
    expect(rapport.evenementsCrees).toBe(0);
    expect(rapport.tachesCreees).toBe(0);
    expect(rapport.emailsEnvoyes).toBe(0);
    expect(rapport.etatsEcrits).toBe(0);
    expect(rapport.compatibles + rapport.incompatibles + rapport.aVerifier).toBe(rapport.pairesEvaluees);
    expect(rapport.pairesEvaluees).toBe(rapport.biensActifs * rapport.acquereursActifs);
  });

  it("un dry-run répété n'écrit jamais rien (aucune ligne créée pour une paire de test dédiée)", async () => {
    const bien = await creerBienDeTest("DRY1", 300000);
    const acquereur = await creerAcquereurDeTest("DRY1", 400000);

    await calculerBaselineDryRun();
    await calculerBaselineDryRun();

    expect(await lireEtat(bien.id, acquereur.id)).toBeUndefined();
  });
});

describe("appliquerBaseline — écrit silencieusement, jamais d'événement", () => {
  it("écrit l'état technique de la paire sans jamais émettre d'événement, idempotent sur rejeu", async () => {
    const bien = await creerBienDeTest("APPLY1", 300000); // compatible avec l'acquéreur ci-dessous
    const acquereur = await creerAcquereurDeTest("APPLY1", 400000);

    const premier = await appliquerBaseline({ autoriserEcrasementExistant: true });
    expect(premier.statut).toBe("ok");

    let etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dernierStatut).toBe("compatible");
    expect(etat?.cycleCompatibilite).toBe(1); // baseline compatible → cycle 1, jamais 0

    const evenements = await getDb()
      .select()
      .from(evenementsMetier)
      .where(and(eq(evenementsMetier.bienId, bien.id), eq(evenementsMetier.acquereurId, acquereur.id)));
    expect(evenements).toHaveLength(0); // AUCUN événement, jamais — c'est le cœur de la baseline silencieuse

    // Rejeu : idempotent, ne change ni le statut ni le cycle pour cette paire.
    const second = await appliquerBaseline({ autoriserEcrasementExistant: true });
    expect(second.statut).toBe("ok");
    etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.cycleCompatibilite).toBe(1);
  });

  it("baseline sur une paire incompatible : cycle 0, aucun événement", async () => {
    const bien = await creerBienDeTest("APPLY2", 900000); // > budgetMax
    const acquereur = await creerAcquereurDeTest("APPLY2", 400000);

    await appliquerBaseline({ autoriserEcrasementExistant: true });
    const etat = await lireEtat(bien.id, acquereur.id);
    expect(etat?.dernierStatut).toBe("incompatible");
    expect(etat?.cycleCompatibilite).toBe(0);
  });

  it("refuse (409 logique) une application sans confirmation si la table contient déjà des lignes", async () => {
    const bien = await creerBienDeTest("REFUS1", 300000);
    const acquereur = await creerAcquereurDeTest("REFUS1", 400000);
    // Pose une ligne technique pour garantir une table non vide, indépendamment de tout autre
    // contenu déjà présent dans la base de développement partagée.
    await ecrireEtatPaire(
      { bienId: bien.id, acquereurId: acquereur.id, dernierStatut: "compatible", dansPerimetreActif: true, cycleCompatibilite: 1 },
      getDb()
    );

    const resultat = await appliquerBaseline({ autoriserEcrasementExistant: false });
    expect(resultat.statut).toBe("refuse_table_non_vide");
    if (resultat.statut === "refuse_table_non_vide") {
      expect(resultat.lignesExistantes).toBeGreaterThan(0);
    }
  });

  it("rebuild (§28) : ne redescend jamais en dessous du plus haut cycle déjà présent dans evenements_metier pour cette paire", async () => {
    const bien = await creerBienDeTest("REBUILD1", 300000); // compatible
    const acquereur = await creerAcquereurDeTest("REBUILD1", 400000);

    // Simule un historique déjà avancé pour cette paire (cycle 5 déjà émis par le passé), sans
    // ligne d'état correspondante (table technique perdue/à reconstruire).
    await getDb().insert(evenementsMetier).values({
      typeEvenement: "compatibilite_bien_acquereur_devenue_compatible",
      bienId: bien.id,
      acquereurId: acquereur.id,
      cycleCompatibilite: 5,
    });

    await appliquerBaseline({ autoriserEcrasementExistant: true });

    const etat = await lireEtat(bien.id, acquereur.id);
    // Jamais 1 (ce que produirait une baseline naïve ignorant l'historique) : le rebuild reprend
    // au moins au cycle déjà observé, pour ne jamais pouvoir réémettre un cycle déjà utilisé.
    expect(etat?.cycleCompatibilite).toBe(5);
  });
});
