import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ErreurSeedDemo,
  IDS,
  NOM_VARIABLE_CONFIRMATION,
  VALEUR_CONFIRMATION_ATTENDUE,
  construireDataset,
  executerSeedDemo,
} from "./seed-demo.mjs";

// Base de test dédiée uniquement (vitest.setup.ts a déjà résolu DATABASE_URL via
// src/db/resoudreDatabaseUrlTest.ts, qui refuse tout ce qui n'est pas une base locale nommée
// "...test..."). Cette suite écrit ET nettoie des lignes métier : la garde ci-dessous est une
// seconde barrière explicite, jamais une confiance aveugle dans la configuration ambiante.
const URL_TEST = process.env.DATABASE_URL ?? "";
if (!/test/i.test(URL_TEST)) {
  throw new Error("seed-demo.test.ts refuse de s'exécuter : DATABASE_URL ne désigne pas une base de test.");
}

const sql = postgres(URL_TEST);

const ENV_CONFIRME = { [NOM_VARIABLE_CONFIRMATION]: VALEUR_CONFIRMATION_ATTENDUE };

// Enfants avant parents. Portée strictement locale à cette suite : le script de seed lui-même ne
// sait jamais supprimer quoi que ce soit (DEMO-02, aucune purge, aucun reset).
const TABLES_A_NETTOYER = [
  "evenements_metier",
  "notes_prospect_vendeur",
  "notes_bien",
  "taches",
  "remuneration",
  "compromis",
  "offre_visites",
  "offres",
  "comptes_rendus_visite",
  "visites",
  "secteurs_recherche_acquereur",
  "documents_bien",
  "photos_bien",
  "prospects_vendeurs",
  "acquereurs",
  "biens",
];

async function nettoyer() {
  for (const table of TABLES_A_NETTOYER) await sql.unsafe(`delete from ${table}`);
}

async function compter(table: string): Promise<number> {
  const [{ n }] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`);
  return n;
}

beforeEach(nettoyer);

afterAll(async () => {
  await nettoyer();
  await sql.end();
});

describe("seed-demo — gardes de sécurité", () => {
  it("refuse sans la confirmation explicite, et n'écrit rien", async () => {
    await expect(executerSeedDemo(sql, { env: {} })).rejects.toMatchObject({ code: "confirmation_manquante" });
    await expect(executerSeedDemo(sql, { env: { [NOM_VARIABLE_CONFIRMATION]: "oui" } })).rejects.toBeInstanceOf(
      ErreurSeedDemo
    );
    expect(await compter("biens")).toBe(0);
    expect(await compter("acquereurs")).toBe(0);
  });

  it("refuse si la base porte une donnée métier étrangère au dataset, sans rien supprimer", async () => {
    await sql`
      insert into biens (reference, titre, type, adresse, ville, code_postal, surface, pieces, prix, date_mandat)
      values ('REEL-001', 'Bien réel du conseiller', 'appartement', '1 rue Réelle', 'Houilles', '78800', 60, 3, 300000, '2026-01-01')
    `;

    await expect(executerSeedDemo(sql, { env: ENV_CONFIRME })).rejects.toMatchObject({
      code: "donnees_metier_inconnues",
    });

    // Aucune suppression, aucune écriture partielle : la ligne étrangère est intacte et seule.
    expect(await compter("biens")).toBe(1);
    expect(await compter("acquereurs")).toBe(0);
    expect(await compter("prospects_vendeurs")).toBe(0);
  });

  it("refuse un dataset de démonstration incomplet plutôt que de le réparer", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });
    await sql`delete from taches where id = ${IDS.taches[0]}`;

    await expect(executerSeedDemo(sql, { env: ENV_CONFIRME })).rejects.toMatchObject({ code: "dataset_partiel" });
    expect(await compter("taches")).toBe(IDS.taches.length - 1);
  });
});

describe("seed-demo — création du dataset", () => {
  it("peuple une base métier vierge et rend les compteurs annoncés", async () => {
    const resultat = await executerSeedDemo(sql, { env: ENV_CONFIRME });

    expect(resultat.statut).toBe("cree");
    expect(await compter("prospects_vendeurs")).toBe(5);
    expect(await compter("acquereurs")).toBe(4);
    expect(await compter("biens")).toBe(2);
    expect(await compter("secteurs_recherche_acquereur")).toBe(4);
    expect(await compter("visites")).toBe(2);
    expect(await compter("comptes_rendus_visite")).toBe(1);
    expect(await compter("offres")).toBe(1);
    expect(await compter("offre_visites")).toBe(1);
    expect(await compter("compromis")).toBe(1);
    expect(await compter("remuneration")).toBe(1);
    expect(await compter("taches")).toBe(7);
    expect(await compter("notes_bien")).toBe(1);
    expect(await compter("notes_prospect_vendeur")).toBe(1);
    expect(await compter("evenements_metier")).toBe(2);
  });

  it("donne à chaque bien un vendeur d'origine, comme le ferait une signature de mandat réelle", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    for (const bienId of IDS.biens) {
      const vendeurs = await sql`
        select id, nom, prenom, mandat_signe_le, date_perte
        from prospects_vendeurs where bien_id = ${bienId}
      `;
      // Exactement un : biens.bien_id est UNIQUE côté prospect, deux vendeurs d'origine pour un
      // même bien n'auraient aucun sens métier.
      expect(vendeurs).toHaveLength(1);
      expect(vendeurs[0].mandat_signe_le).not.toBeNull();
      expect(vendeurs[0].date_perte).toBeNull();
    }
  });

  it("émet un événement mandat_signe par vendeur converti, et rien d'autre", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const evenements = await sql`
      select type_evenement, prospect_vendeur_id, compte_rendu_visite_id, compromis_id, bien_id, acquereur_id
      from evenements_metier order by survenu_le
    `;

    expect(evenements).toHaveLength(2);
    for (const e of evenements) {
      expect(e.type_evenement).toBe("mandat_signe");
      // Cible unique : le prospect converti, jamais une seconde cible renseignée "pour faire complet".
      expect(e.prospect_vendeur_id).not.toBeNull();
      expect(e.compte_rendu_visite_id).toBeNull();
      expect(e.compromis_id).toBeNull();
      expect(e.bien_id).toBeNull();
      expect(e.acquereur_id).toBeNull();
    }

    const convertis = await sql`select id from prospects_vendeurs where bien_id is not null order by id`;
    expect(evenements.map((e) => e.prospect_vendeur_id).sort()).toEqual(convertis.map((c) => c.id).sort());
  });

  it("laisse la tâche ascenseur dire ce que le moteur fait réellement, jamais qu'un rapprochement est bloqué", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const [tache] = await sql`
      select titre, contexte from taches where contexte ilike '%ascenseur%'
    `;

    expect(tache.contexte).toContain("À vérifier");
    // Le moteur produit bel et bien un rapprochement (a_verifier) : prétendre le contraire
    // contredirait l'encart Acquéreurs compatibles affiché sur la même fiche.
    expect(tache.contexte).not.toContain("bloque");
  });

  it("relit une seconde exécution sans créer le moindre doublon", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });
    const resultat = await executerSeedDemo(sql, { env: ENV_CONFIRME });

    expect(resultat.statut).toBe("deja_present");
    expect(await compter("biens")).toBe(2);
    expect(await compter("acquereurs")).toBe(4);
    expect(await compter("taches")).toBe(7);
    expect(await compter("prospects_vendeurs")).toBe(5);
    expect(await compter("evenements_metier")).toBe(2);
  });

  it("laisse le vendeur à convertir en direct sans bien ni mandat signé", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const [prospect] = await sql`
      select mandat_propose_le, mandat_signe_le, bien_id, date_perte
      from prospects_vendeurs where id = ${IDS.prospects[0]}
    `;
    expect(prospect.mandat_propose_le).not.toBeNull();
    expect(prospect.mandat_signe_le).toBeNull();
    expect(prospect.bien_id).toBeNull();
    expect(prospect.date_perte).toBeNull();
  });

  it("relie offre, compromis et rémunération au même dossier, jalons du bien posés", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const [dossier] = await sql`
      select
        o.bien_id as offre_bien, o.acquereur_id as offre_acquereur, o.statut as offre_statut, o.montant,
        c.bien_id as compromis_bien, c.acquereur_id as compromis_acquereur, c.statut as compromis_statut,
        c.offre_id, c.prix_convenu, c.date_acte_reelle,
        r.montant_remuneration_conseiller_centimes as part_conseiller,
        r.date_encaissement_reelle,
        b.offre_en_cours_le, b.compromis_signe_le
      from compromis c
      join offres o on o.id = c.offre_id
      join remuneration r on r.compromis_id = c.id
      join biens b on b.id = c.bien_id
      where c.id = ${IDS.compromis[0]}
    `;

    expect(dossier.offre_bien).toBe(IDS.biens[1]);
    expect(dossier.compromis_bien).toBe(IDS.biens[1]);
    expect(dossier.offre_acquereur).toBe(IDS.acquereurs[3]);
    expect(dossier.compromis_acquereur).toBe(IDS.acquereurs[3]);
    expect(dossier.offre_statut).toBe("acceptee");
    expect(dossier.compromis_statut).toBe("en_cours");
    expect(dossier.prix_convenu).toBe(dossier.montant);
    // Rémunération prévisionnelle, jamais encaissée : c'est un montant à venir que le tableau de
    // bord doit pouvoir montrer comme tel.
    expect(dossier.part_conseiller).toBeGreaterThan(0);
    expect(dossier.date_encaissement_reelle).toBeNull();
    expect(dossier.date_acte_reelle).toBeNull();
    // Jalons ADR-014 posés comme le feraient les Server Actions correspondantes.
    expect(dossier.offre_en_cours_le).not.toBeNull();
    expect(dossier.compromis_signe_le).not.toBeNull();
  });

  it("rattache le compte rendu à sa visite réalisée et à l'offre qui en découle", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const [lien] = await sql`
      select cr.visite_id, cr.interet, v.statut as visite_statut, cr.date_visite, o.date_offre
      from offre_visites ov
      join comptes_rendus_visite cr on cr.id = ov.compte_rendu_visite_id
      join visites v on v.id = cr.visite_id
      join offres o on o.id = ov.offre_id
    `;

    expect(lien.visite_statut).toBe("realisee");
    expect(lien.interet).toBe("interesse");
    // Invariant porté par la Server Action (ADR-019), reproduit par le seed.
    expect(String(lien.date_visite) <= String(lien.date_offre)).toBe(true);
  });

  it("ne crée aucune donnée fiscale personnelle ni aucune connexion Google", async () => {
    const dossierFiscalAvant = await compter("dossier_fiscal");

    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    expect(await compter("profil_fiscal")).toBe(0);
    expect(await compter("rfr_foyer")).toBe(0);
    expect(await compter("historique_amorcage")).toBe(0);
    // dossier_fiscal porte une ligne de configuration créée par migration : le seed ne doit ni
    // l'ajouter, ni la modifier, ni en créer une seconde.
    expect(await compter("dossier_fiscal")).toBe(dossierFiscalAvant);
    expect(await compter("connexions_google")).toBe(0);
  });
});

describe("seed-demo — compatibilité produite par le vrai moteur", () => {
  it("fait ressortir un compatible, un à vérifier et deux incompatibles sur le bien pivot", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const { evaluerCompatibiliteBien } = await import("@/lib/compatibilite/orchestration");
    const resultats = await evaluerCompatibiliteBien(IDS.biens[0]);
    const parAcquereur = new Map(resultats.map((r) => [r.acquereurId, r]));

    // Aucun statut n'est stocké : ces quatre verdicts sont recalculés par evaluerCompatibilite().
    expect(parAcquereur.get(IDS.acquereurs[0])?.statutGlobal).toBe("compatible");
    expect(parAcquereur.get(IDS.acquereurs[1])?.statutGlobal).toBe("a_verifier");
    expect(parAcquereur.get(IDS.acquereurs[2])?.statutGlobal).toBe("incompatible");
    expect(parAcquereur.get(IDS.acquereurs[3])?.statutGlobal).toBe("incompatible");

    // Le "à vérifier" doit venir de l'ascenseur inconnu (ADR-009, inconnu != non), jamais d'un
    // critère laissé vide par inadvertance.
    const accessibilite = parAcquereur
      .get(IDS.acquereurs[1])
      ?.criteres.find((c) => c.critere === "accessibilite");
    expect(accessibilite?.statut).toBe("a_verifier");

    // Le premier incompatible l'est par le budget, le second par le secteur : deux motifs
    // distincts et lisibles, jamais deux fois la même explication.
    expect(parAcquereur.get(IDS.acquereurs[2])?.criteres.find((c) => c.critere === "budget_max")?.statut).toBe(
      "incompatible"
    );
    expect(
      parAcquereur.get(IDS.acquereurs[3])?.criteres.find((c) => c.critere === "secteur_geographique")?.statut
    ).toBe("incompatible");
  });

  it("rend l'acquéreur du dossier avancé pleinement compatible avec son bien", async () => {
    await executerSeedDemo(sql, { env: ENV_CONFIRME });

    const { evaluerCompatibiliteBien } = await import("@/lib/compatibilite/orchestration");
    const resultats = await evaluerCompatibiliteBien(IDS.biens[1]);
    const acheteur = resultats.find((r) => r.acquereurId === IDS.acquereurs[3]);

    expect(acheteur?.statutGlobal).toBe("compatible");
  });
});

describe("seed-demo — dataset", () => {
  it("n'utilise que des emails de domaine réservé, jamais une adresse délivrable", () => {
    const dataset = construireDataset(new Date("2026-09-01T09:00:00Z"));
    const emails = [
      ...dataset.acquereurs.map((a: { email: string }) => a.email),
      ...dataset.prospects.map((p: { email: string }) => p.email),
    ];

    expect(emails.length).toBe(9);
    for (const email of emails) expect(email.endsWith("@example.test")).toBe(true);
  });

  it("ne seede ni document ni photo — aucune ligne ne peut pointer vers un fichier absent", () => {
    const dataset = construireDataset(new Date("2026-09-01T09:00:00Z")) as Record<string, unknown>;

    expect(dataset.documents).toBeUndefined();
    expect(dataset.photos).toBeUndefined();
  });
});
