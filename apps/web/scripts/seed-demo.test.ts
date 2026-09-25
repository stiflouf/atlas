import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ErreurSeedDemo,
  IDS,
  NOM_VARIABLE_CONFIRMATION,
  REGLES_DEMO,
  VALEUR_CONFIRMATION_ATTENDUE,
  cheminsFichiersSeed,
  construireDataset,
  executerSeedDemo,
} from "./seed-demo.mjs";

// DEMO_SEED_CANONICAL_V1 — test d'intégration réel du seed de démonstration (base Postgres de test,
// fichiers écrits dans un répertoire temporaire dédié). Couvre : sécurité, run initial, rejeu, run
// après résidus, entités canoniques et leurs liens, moteur de compatibilité réel, dates relatives,
// Aujourd'hui, candidats d'automatisation, bon signé (PDF + SHA-256), fichiers physiques, cleanup.
//
// Garde-fou test/production : vitest.setup.ts fixe DATABASE_URL sur une base locale dont le nom
// contient "test". Cette suite écrit ET nettoie des lignes métier : seconde barrière explicite.
const URL_TEST = process.env.DATABASE_URL ?? "";
if (!/test/i.test(URL_TEST)) {
  throw new Error("seed-demo.test.ts refuse de s'exécuter : DATABASE_URL ne désigne pas une base de test.");
}

const sql = postgres(URL_TEST);
// Un run du seed génère des PDF (pdf-lib), une image (sharp) et ~80 INSERT : quelques secondes sur
// un poste chargé, bien au-delà des 5 s par défaut de Vitest. Un timeout à mi-transaction laisserait
// une base incohérente pour les tests suivants.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
const RACINE_STOCKAGE = await mkdtemp(path.join(tmpdir(), "domiora-seed-demo-"));
const ENV_CONFIRME = { [NOM_VARIABLE_CONFIRMATION]: VALEUR_CONFIRMATION_ATTENDUE, ATLAS_DOCUMENT_STORAGE_DIR: RACINE_STOCKAGE };
const CHEMINS = cheminsFichiersSeed(RACINE_STOCKAGE);

// Enfants avant parents — TOUTES les tables que ce seed écrit ou que l'usage de la démo peut
// alimenter en dépendance (tâches automatiques, événements, exécutions, états de compatibilité).
// Portée strictement locale à cette suite : le script de seed lui-même ne supprime que son propre
// périmètre, jamais une table entière. Aucun TRUNCATE, aucune désactivation de FK.
const TABLES_A_NETTOYER = [
  "executions_automatisation",
  "evenements_metier",
  "taches",
  "compatibilites_a_resynchroniser",
  // Dette fermée (DEMO_SEED_CANONICAL_V1) : cette table référence biens et acquereurs en NO ACTION —
  // absente de cette purge, une seule paire résiduelle faisait échouer la suppression des acquéreurs.
  "compatibilites_bien_acquereur_etat",
  "interactions",
  "signatures_bon_visite",
  "bons_visite",
  "documents_bien",
  "photos_bien",
  "notes_prospect_vendeur",
  "notes_bien",
  "remuneration",
  "compromis",
  "offre_visites",
  "offres",
  "comptes_rendus_visite",
  "visites",
  "secteurs_recherche_acquereur",
  "parties_mandat",
  "prospects_vendeurs",
  "mandats",
  "biens",
  "acquereurs",
  "parties_projet",
  "projets_vendeur",
  "contacts",
];

async function nettoyer() {
  for (const table of TABLES_A_NETTOYER) await sql.unsafe(`delete from ${table}`);
  // Les règles activées par le seed reviennent à l'état "absent" (défaut produit : inactive).
  await sql`delete from configurations_automatisation where regle_code = any(${REGLES_DEMO.map((r) => r.regleCode)}::text[])`;
  await rm(RACINE_STOCKAGE, { recursive: true, force: true });
}

async function compter(table: string): Promise<number> {
  const [{ n }] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`);
  return n;
}

async function fichierExiste(chemin: string): Promise<boolean> {
  try {
    await stat(chemin);
    return true;
  } catch {
    return false;
  }
}

async function seeder(maintenant?: Date) {
  return executerSeedDemo(sql, { env: ENV_CONFIRME, maintenant });
}

// Jour civil "YYYY-MM-DD" dans le fuseau de l'application, même primitive que le seed.
function jourApp(date: Date, decalageJours = 0): string {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + decalageJours);
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d);
}

// Colonnes SQL `date` : postgres.js les rend en Date ancrée à minuit UTC.
function jourCivil(valeur: Date | string): string {
  return valeur instanceof Date ? valeur.toISOString().slice(0, 10) : String(valeur).slice(0, 10);
}

const COMPTEURS_ATTENDUS = {
  contacts: 12,
  projets_vendeur: 6,
  parties_projet: 6,
  prospects_vendeurs: 6,
  biens: 3,
  mandats: 3,
  parties_mandat: 3,
  acquereurs: 6,
  secteurs_recherche_acquereur: 8,
  visites: 6,
  comptes_rendus_visite: 3,
  bons_visite: 1,
  signatures_bon_visite: 1,
  documents_bien: 3,
  photos_bien: 1,
  interactions: 3,
  offres: 2,
  offre_visites: 2,
  compromis: 1,
  remuneration: 1,
  taches: 6,
  notes_bien: 1,
  notes_prospect_vendeur: 1,
  evenements_metier: 3,
  compatibilites_bien_acquereur_etat: 18,
};

async function verifierCompteurs() {
  for (const [table, attendu] of Object.entries(COMPTEURS_ATTENDUS)) {
    expect(await compter(table), table).toBe(attendu);
  }
}

beforeEach(nettoyer);

afterAll(async () => {
  await nettoyer();
  await sql.end();
});

describe("seed-demo — gardes de sécurité", () => {
  it("refuse sans la confirmation explicite, et n'écrit rien", async () => {
    await expect(executerSeedDemo(sql, { env: { ATLAS_DOCUMENT_STORAGE_DIR: RACINE_STOCKAGE } })).rejects.toMatchObject({ code: "confirmation_manquante" });
    await expect(executerSeedDemo(sql, { env: { [NOM_VARIABLE_CONFIRMATION]: "oui", ATLAS_DOCUMENT_STORAGE_DIR: RACINE_STOCKAGE } })).rejects.toBeInstanceOf(ErreurSeedDemo);
    expect(await compter("biens")).toBe(0);
    expect(await compter("contacts")).toBe(0);
    expect(await fichierExiste(CHEMINS.document(`demo-seed-document-751`))).toBe(false);
  });

  it("refuse si la base porte une donnée métier étrangère au dataset, sans rien supprimer ni écrire", async () => {
    const [{ id: workspaceId }] = await sql`select id from workspaces limit 1`;
    await sql`
      insert into biens (reference, titre, type, adresse, ville, code_postal, surface, pieces, prix, date_mandat, workspace_id)
      values ('REEL-001', 'Bien réel du conseiller', 'appartement', '1 rue Réelle', 'Houilles', '78800', 60, 3, 300000, '2026-01-01', ${workspaceId})
    `;
    await sql`insert into contacts (workspace_id, nom) values (${workspaceId}, 'Contact réel')`;

    await expect(seeder()).rejects.toMatchObject({ code: "donnees_metier_inconnues" });

    expect(await compter("biens")).toBe(1);
    expect(await compter("contacts")).toBe(1);
    expect(await compter("acquereurs")).toBe(0);
    expect(await compter("prospects_vendeurs")).toBe(0);
  });

  it("refuse une donnée étrangère même après un premier seed réussi (jamais de suppression hors périmètre)", async () => {
    await seeder();
    const [{ id: workspaceId }] = await sql`select id from workspaces limit 1`;
    await sql`insert into contacts (workspace_id, nom) values (${workspaceId}, 'Contact réel ajouté après la démo')`;

    await expect(seeder()).rejects.toMatchObject({ code: "donnees_metier_inconnues" });

    expect(await compter("contacts")).toBe(COMPTEURS_ATTENDUS.contacts + 1);
    expect(await compter("biens")).toBe(COMPTEURS_ATTENDUS.biens);
  });
});

describe("seed-demo — création, rejeu, résidus", () => {
  it("run 1 : peuple une base métier vierge, tous les compteurs, règles activées, fichiers écrits", async () => {
    const resultat = await seeder();

    expect(resultat.statut).toBe("cree");
    await verifierCompteurs();
    const regles = await sql`select regle_code, active, seuil_jours from configurations_automatisation where regle_code = any(${REGLES_DEMO.map((r) => r.regleCode)}::text[])`;
    expect(regles).toHaveLength(REGLES_DEMO.length);
    for (const r of regles) expect(r.active).toBe(true);
    expect(regles.find((r) => r.regle_code === "visite_sans_compte_rendu")?.seuil_jours).toBe(1);
    for (const cle of ["demo-seed-document-751", "demo-seed-document-752", "demo-seed-document-753", "demo-seed-signature-661"]) {
      expect(await fichierExiste(CHEMINS.document(cle)), cle).toBe(true);
    }
    expect(await fichierExiste(CHEMINS.photoOriginale("demo-seed-photo-851"))).toBe(true);
    expect(await fichierExiste(CHEMINS.photoOptimisee("demo-seed-photo-851"))).toBe(true);
  });

  it("run 2 : rejeu sur dataset complet → périmètre recréé, aucun doublon, état final identique", async () => {
    const maintenant = new Date("2026-09-21T09:00:00Z");
    await seeder(maintenant);
    const avant = await instantane();

    const resultat = await seeder(maintenant);

    expect(resultat.statut).toBe("recree");
    await verifierCompteurs();
    expect(await instantane()).toEqual(avant);
  });

  it("run 3 : rejeu depuis un dataset partiel → réparé, état complet", async () => {
    await seeder();
    await sql`delete from taches where id = ${IDS.taches[0]}`;
    await sql`delete from compatibilites_bien_acquereur_etat`;
    await sql`delete from interactions where id = ${IDS.interactions[0]}`;

    const resultat = await seeder();

    expect(resultat.statut).toBe("recree_depuis_partiel");
    await verifierCompteurs();
  });

  it("run après résidus d'usage de la démo (tâches automatiques, événements, exécutions, états de compatibilité, prospect converti en direct) → succès, même état final", async () => {
    const maintenant = new Date("2026-09-21T09:00:00Z");
    await seeder(maintenant);
    const avant = await instantane();
    const [{ id: workspaceId }] = await sql`select id from workspaces limit 1`;

    // Ce qu'un scan d'automatisation et une démonstration réelle laissent derrière eux.
    const [evt] = await sql`insert into evenements_metier (type_evenement, visite_id, survenu_le, workspace_id) values ('visite_realisee', ${IDS.visites.realiseeHouilles}, now(), ${workspaceId}) returning id`;
    const [tache] = await sql`insert into taches (titre, type, priorite, origine, origine_code, visite_canonique_id, workspace_id) values ('Préparer la visite de demain', 'appel', 'haute', 'automatique', 'visite_j_1', ${IDS.visites.demain}, ${workspaceId}) returning id`;
    await sql`insert into executions_automatisation (regle_code, evenement_id, tache_id, demarree_le, reussie_le, nombre_tentatives) values ('visite_j_1', ${evt.id}, ${tache.id}, now(), now(), 1)`;
    await sql`insert into compatibilites_a_resynchroniser (workspace_id, acquereur_id) values (${workspaceId}, ${IDS.acquereurs[0]})`;
    await sql`update compatibilites_bien_acquereur_etat set dernier_statut = 'compatible', cycle_compatibilite = 3 where bien_id = ${IDS.biens[0]} and acquereur_id = ${IDS.acquereurs[2]}`;
    // Hélène Vasseur convertie en direct : bien + mandat + partie mandant + événement, ids aléatoires.
    const [bienVasseur] = await sql`insert into biens (reference, titre, type, adresse, ville, code_postal, surface, pieces, prix, date_mandat, workspace_id) values ('DEMO-LIVE-001', 'Maison Vasseur', 'maison', '8 rue du Clos Fictif', 'Sartrouville', '78500', 110, 5, 625000, '2026-09-21', ${workspaceId}) returning id`;
    await sql`update prospects_vendeurs set bien_id = ${bienVasseur.id}, mandat_signe_le = now() where id = ${IDS.prospects[0]}`;
    const [mandatVasseur] = await sql`insert into mandats (bien_id, projet_vendeur_id, type, date_debut) values (${bienVasseur.id}, ${IDS.projetsVendeur[0]}, 'simple', '2026-09-21') returning id`;
    await sql`insert into parties_mandat (mandat_id, contact_id, role) values (${mandatVasseur.id}, ${IDS.contacts.vasseur}, 'mandant')`;
    await sql`insert into evenements_metier (type_evenement, prospect_vendeur_id, survenu_le, workspace_id) values ('mandat_signe', ${IDS.prospects[0]}, now(), ${workspaceId})`;
    await sql`insert into visites (bien_id, acquereur_id, date_prevue, statut) values (${bienVasseur.id}, ${IDS.acquereurs[3]}, '2026-09-25', 'planifiee')`;

    const resultat = await seeder(maintenant);

    expect(resultat.statut).toBe("recree");
    await verifierCompteurs();
    expect(await instantane()).toEqual(avant);
    expect(await compter("executions_automatisation")).toBe(0);
    const [vasseur] = await sql`select bien_id, mandat_signe_le from prospects_vendeurs where id = ${IDS.prospects[0]}`;
    expect(vasseur.bien_id).toBeNull();
    expect(vasseur.mandat_signe_le).toBeNull();
  });

  it("dates relatives : rejoué à une autre date, le scénario se recale (aujourd'hui / demain / J-6 / J+75)", async () => {
    const maintenant = new Date("2027-03-15T14:00:00Z");
    await seeder(maintenant);

    const visites = await sql`select id, date_prevue from visites`;
    const dates = new Map(visites.map((v) => [v.id, jourCivil(v.date_prevue)]));
    expect(dates.get(IDS.visites.aujourdhui)).toBe(jourApp(maintenant, 0));
    expect(dates.get(IDS.visites.demain)).toBe(jourApp(maintenant, 1));
    expect(dates.get(IDS.visites.sansCompteRendu)).toBe(jourApp(maintenant, -6));
    const [compromis] = await sql`select date_acte from compromis where id = ${IDS.compromis[0]}`;
    expect(jourCivil(compromis.date_acte)).toBe(jourApp(maintenant, 75));
    const [mandat] = await sql`select date_fin from mandats where id = ${IDS.mandats[2]}`;
    expect(jourCivil(mandat.date_fin)).toBe(jourApp(maintenant, 20));
  });
});

// Instantané comparable entre deux runs au même `maintenant` : colonnes métier stables (jamais
// `observe_le`/`modifie_le`/hash — le PDF est regénéré à chaque run, son hash change légitimement).
async function instantane() {
  const lignes = async (requete: string) => sql.unsafe(requete);
  return {
    contacts: await lignes("select id, nom, prenom, email, telephone from contacts order by id"),
    prospects: await lignes("select id, contact_id, projet_vendeur_id, bien_id, mandat_signe_le, motif_perte from prospects_vendeurs order by id"),
    biens: await lignes("select id, reference, prix, statut_mandat, offre_en_cours_le, compromis_signe_le from biens order by id"),
    mandats: await lignes("select id, bien_id, projet_vendeur_id, type, date_debut, date_fin from mandats order by id"),
    partiesMandat: await lignes("select id, mandat_id, contact_id, role from parties_mandat order by id"),
    acquereurs: await lignes("select id, contact_id, budget_min, budget_max, pieces_min, surface_min from acquereurs order by id"),
    visites: await lignes("select id, bien_id, acquereur_id, date_prevue, statut, rendez_vous_calendar_id, realisee_le from visites order by id"),
    comptesRendus: await lignes("select id, visite_id, interet from comptes_rendus_visite order by id"),
    bons: await lignes("select id, visite_id, statut, version, document_id from bons_visite order by id"),
    signatures: await lignes("select id, bon_visite_id, contact_id, signature_cle_stockage from signatures_bon_visite order by id"),
    documents: await lignes("select id, bien_id, visite_id, type_document, cle_stockage from documents_bien order by id"),
    photos: await lignes("select id, bien_id, cle_stockage, ordre from photos_bien order by id"),
    interactions: await lignes("select id, contact_id, type, visite_id, bien_id, nature_metier from interactions order by id"),
    offres: await lignes("select id, bien_id, acquereur_id, montant, statut, date_decision from offres order by id"),
    compromis: await lignes("select id, offre_id, statut, prix_convenu, date_acte from compromis order by id"),
    taches: await lignes("select id, titre, echeance, terminee_le, bien_id, acquereur_id, prospect_vendeur_id, compromis_id from taches order by id"),
    evenements: await lignes("select id, type_evenement, prospect_vendeur_id from evenements_metier order by id"),
    compatibilites: await lignes("select bien_id, acquereur_id, dernier_statut, cycle_compatibilite from compatibilites_bien_acquereur_etat order by bien_id, acquereur_id"),
  };
}

describe("seed-demo — entités canoniques et liens", () => {
  it("chaque bien a un mandat courant, un mandant canonique et un vendeur d'origine reliés au même Contact", async () => {
    await seeder();

    for (const bienId of IDS.biens) {
      const [ligne] = await sql`
        select m.id as mandat_id, m.projet_vendeur_id, pm.contact_id as mandant_id, p.contact_id as prospect_contact_id, pp.contact_id as partie_projet_contact_id
        from mandats m
        join parties_mandat pm on pm.mandat_id = m.id and pm.role = 'mandant'
        join prospects_vendeurs p on p.bien_id = m.bien_id
        join parties_projet pp on pp.projet_vendeur_id = m.projet_vendeur_id
        where m.bien_id = ${bienId}
      `;
      expect(ligne, bienId).toBeDefined();
      expect(ligne.mandant_id).toBe(ligne.prospect_contact_id);
      expect(ligne.partie_projet_contact_id).toBe(ligne.prospect_contact_id);
    }
  });

  it("chaque prospect et chaque acquéreur pointe vers son Contact, une seule identité par personne", async () => {
    await seeder();

    const [{ n: prospectsSansContact }] = await sql`select count(*)::int as n from prospects_vendeurs where contact_id is null or projet_vendeur_id is null`;
    const [{ n: acquereursSansContact }] = await sql`select count(*)::int as n from acquereurs where contact_id is null`;
    expect(prospectsSansContact).toBe(0);
    expect(acquereursSansContact).toBe(0);
    const [{ n: contactsDoubles }] = await sql`select count(*)::int as n from (select email from contacts group by email having count(*) > 1) d`;
    expect(contactsDoubles).toBe(0);
  });

  it("visites : 100 % natives, une aujourd'hui, une demain, une passée sans compte rendu, trois réalisées avec realisee_le et CR", async () => {
    const maintenant = new Date();
    await seeder(maintenant);

    const visites = await sql`select id, bien_id, acquereur_id, date_prevue, statut, rendez_vous_calendar_id, realisee_le from visites`;
    for (const v of visites) expect(v.rendez_vous_calendar_id).toBeNull();
    const parId = new Map(visites.map((v) => [v.id, v]));
    expect(parId.get(IDS.visites.aujourdhui)).toMatchObject({ statut: "planifiee" });
    expect(jourCivil(parId.get(IDS.visites.aujourdhui)!.date_prevue)).toBe(jourApp(maintenant, 0));
    expect(jourCivil(parId.get(IDS.visites.demain)!.date_prevue)).toBe(jourApp(maintenant, 1));
    expect(parId.get(IDS.visites.sansCompteRendu)).toMatchObject({ statut: "planifiee" });
    expect(jourCivil(parId.get(IDS.visites.sansCompteRendu)!.date_prevue) < jourApp(maintenant, 0)).toBe(true);
    const [{ n: crSansCompteRendu }] = await sql`select count(*)::int as n from comptes_rendus_visite where visite_id = ${IDS.visites.sansCompteRendu}`;
    expect(crSansCompteRendu).toBe(0);

    const realisees = visites.filter((v) => v.statut === "realisee");
    expect(realisees).toHaveLength(3);
    for (const v of realisees) {
      expect(v.realisee_le).not.toBeNull();
      const [cr] = await sql`select bien_id, acquereur_id, date_visite from comptes_rendus_visite where visite_id = ${v.id}`;
      expect(cr.bien_id).toBe(v.bien_id);
      expect(cr.acquereur_id).toBe(v.acquereur_id);
      expect(jourCivil(cr.date_visite)).toBe(jourCivil(v.date_prevue));
    }
  });

  it("bon de visite signé : statut signe, signature, document rattaché à la visite, PDF valide dont le SHA-256 est exactement le hash stocké", async () => {
    await seeder();

    const [bon] = await sql`select * from bons_visite where id = ${IDS.bonsVisite[0]}`;
    expect(bon.statut).toBe("signe");
    expect(bon.visite_id).toBe(IDS.visites.realiseeHouilles);
    expect(bon.signe_le).not.toBeNull();
    expect(bon.annule_le).toBeNull();
    expect(bon.contenu_snapshot.visite.id).toBe(IDS.visites.realiseeHouilles);
    expect(bon.contenu_snapshot.bien.id).toBe(IDS.biens[0]);
    expect(bon.contenu_snapshot.template.texte).toContain("Bon de visite");

    const [signature] = await sql`select * from signatures_bon_visite where bon_visite_id = ${bon.id}`;
    expect(signature.provider).toBe("domiora");
    expect(signature.contact_id).toBe(IDS.contacts.delaunay);
    const png = await readFile(CHEMINS.signature(signature.signature_cle_stockage));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const [document] = await sql`select * from documents_bien where id = ${bon.document_id}`;
    expect(document.visite_id).toBe(IDS.visites.realiseeHouilles);
    expect(document.type_document).toBe("bon_visite");
    expect(document.type_mime).toBe("application/pdf");
    const pdf = await readFile(CHEMINS.document(document.cle_stockage));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBe(document.taille_octets);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(bon.hash_document);
  });

  it("documents et photo : chaque métadonnée pointe vers un fichier réellement présent, dans la disposition attendue par l'UI", async () => {
    await seeder();

    const documents = await sql`select cle_stockage, taille_octets, type_mime from documents_bien`;
    expect(documents).toHaveLength(3);
    for (const d of documents) {
      const contenu = await readFile(CHEMINS.document(d.cle_stockage));
      expect(contenu.byteLength).toBe(d.taille_octets);
      expect(contenu.subarray(0, 5).toString()).toBe("%PDF-");
    }
    const [photo] = await sql`select * from photos_bien where id = ${IDS.photos[0]}`;
    const original = await readFile(CHEMINS.photoOriginale(photo.cle_stockage));
    expect(original.byteLength).toBe(photo.taille_octets_original);
    expect(createHash("sha256").update(original).digest("hex")).toBe(photo.hash_sha256);
    expect(original.subarray(0, 2).toString("hex")).toBe("ffd8");
    const optimisee = await readFile(CHEMINS.photoOptimisee(photo.cle_stockage));
    expect(optimisee.subarray(0, 4).toString()).toBe("RIFF");
  });

  it("retour vendeur : Interaction retour_vendeur_post_visite sur la visite réalisée, vers le mandant réel du bien, dans le workspace", async () => {
    await seeder();

    const [interaction] = await sql`select * from interactions where nature_metier = 'retour_vendeur_post_visite'`;
    expect(interaction.visite_id).toBe(IDS.visites.realiseeHouilles);
    const [{ statut, bien_id }] = await sql`select statut, bien_id from visites where id = ${interaction.visite_id}`;
    expect(statut).toBe("realisee");
    const [mandant] = await sql`
      select pm.contact_id, c.workspace_id from parties_mandat pm
      join mandats m on m.id = pm.mandat_id
      join contacts c on c.id = pm.contact_id
      where m.bien_id = ${bien_id} and pm.role = 'mandant'
    `;
    expect(interaction.contact_id).toBe(mandant.contact_id);
    const [{ id: workspaceId }] = await sql`select id from workspaces limit 1`;
    expect(mandant.workspace_id).toBe(workspaceId);
  });

  it("offres et compromis : une en cours (sans compromis), une acceptée (avec compromis), au plus une acceptée par bien, jalons du bien posés", async () => {
    await seeder();

    const offres = await sql`select id, bien_id, statut, date_decision from offres`;
    expect(offres.map((o) => o.statut).sort()).toEqual(["acceptee", "en_cours"]);
    const enCours = offres.find((o) => o.statut === "en_cours")!;
    const acceptee = offres.find((o) => o.statut === "acceptee")!;
    expect(enCours.date_decision).toBeNull();
    expect(acceptee.date_decision).not.toBeNull();
    expect(enCours.bien_id).not.toBe(acceptee.bien_id);
    const [{ n: accepteesParBien }] = await sql`select count(*)::int as n from offres where bien_id = ${acceptee.bien_id} and statut = 'acceptee'`;
    expect(accepteesParBien).toBe(1);

    const compromis = await sql`select offre_id, bien_id, statut, prix_convenu from compromis`;
    expect(compromis).toHaveLength(1);
    expect(compromis[0].offre_id).toBe(acceptee.id);
    expect(compromis[0].statut).toBe("en_cours");
    const [bienAccepte] = await sql`select offre_en_cours_le, compromis_signe_le from biens where id = ${acceptee.bien_id}`;
    expect(bienAccepte.compromis_signe_le).not.toBeNull();
    const [bienEnCours] = await sql`select offre_en_cours_le, compromis_signe_le from biens where id = ${enCours.bien_id}`;
    expect(bienEnCours.offre_en_cours_le).not.toBeNull();
    expect(bienEnCours.compromis_signe_le).toBeNull();

    const liens = await sql<{ date_visite: Date; date_offre: Date; bien_ok: boolean }[]>`
      select cr.date_visite, o.date_offre, (cr.bien_id = o.bien_id and cr.acquereur_id = o.acquereur_id) as bien_ok
      from offre_visites ov join comptes_rendus_visite cr on cr.id = ov.compte_rendu_visite_id join offres o on o.id = ov.offre_id
    `;
    expect(liens).toHaveLength(2);
    for (const l of liens) {
      expect(l.bien_ok).toBe(true);
      expect(l.date_visite.getTime()).toBeLessThanOrEqual(l.date_offre.getTime());
    }
  });

  it("laisse le vendeur à convertir en direct sans bien ni mandat signé", async () => {
    await seeder();
    const [prospect] = await sql`select mandat_propose_le, mandat_signe_le, bien_id, date_perte from prospects_vendeurs where id = ${IDS.prospects[0]}`;
    expect(prospect.mandat_propose_le).not.toBeNull();
    expect(prospect.mandat_signe_le).toBeNull();
    expect(prospect.bien_id).toBeNull();
    expect(prospect.date_perte).toBeNull();
  });

  it("ne crée aucune donnée fiscale personnelle ni aucune connexion Google", async () => {
    const dossierFiscalAvant = await compter("dossier_fiscal");
    await seeder();
    expect(await compter("profil_fiscal")).toBe(0);
    expect(await compter("rfr_foyer")).toBe(0);
    expect(await compter("historique_amorcage")).toBe(0);
    expect(await compter("dossier_fiscal")).toBe(dossierFiscalAvant);
    expect(await compter("connexions_google")).toBe(0);
  });
});

describe("seed-demo — matching produit par le vrai moteur", () => {
  it("chaque état de compatibilité seedé est exactement celui que le moteur calcule ; le bien pivot montre les trois états", async () => {
    await seeder();
    const { evaluerCompatibiliteBien } = await import("@/lib/compatibilite/orchestration");
    const dataset = construireDataset(new Date());

    const calcules = new Map<string, string>();
    for (const bienId of IDS.biens) {
      for (const r of await evaluerCompatibiliteBien(bienId, WORKSPACE_TEST)) calcules.set(`${bienId}|${r.acquereurId}`, r.statutGlobal);
    }
    for (const attendu of dataset.compatibilitesAttendues) {
      expect(calcules.get(`${attendu.bienId}|${attendu.acquereurId}`), `${attendu.bienId}|${attendu.acquereurId}`).toBe(attendu.statut);
    }
    const seedes = await sql`select bien_id, acquereur_id, dernier_statut from compatibilites_bien_acquereur_etat`;
    for (const s of seedes) expect(calcules.get(`${s.bien_id}|${s.acquereur_id}`)).toBe(s.dernier_statut);

    const pivot = dataset.compatibilitesAttendues.filter((c) => c.bienId === IDS.biens[0]).map((c) => c.statut);
    expect(pivot).toContain("compatible");
    expect(pivot).toContain("a_verifier");
    expect(pivot).toContain("incompatible");
  });
});

describe("seed-demo — Aujourd'hui et automatisations", () => {
  it("le reader Today trouve la visite native d'aujourd'hui ; une tâche est en retard ; le moteur d'opportunités a de la matière", async () => {
    const maintenant = new Date();
    await seeder(maintenant);
    const [{ id: workspaceId }] = await sql`select id from workspaces limit 1`;

    const { visitesDuJour } = await import("@/lib/visiteRepository");
    const duJour = await visitesDuJour(workspaceId, jourApp(maintenant, 0));
    expect(duJour.map((v) => v.id)).toContain(IDS.visites.aujourdhui);
    expect(duJour.find((v) => v.id === IDS.visites.aujourdhui)?.rendezVousCalendarId).toBeUndefined();

    const [{ n: enRetard }] = await sql`select count(*)::int as n from taches where terminee_le is null and annulee_le is null and echeance < ${jourApp(maintenant, 0)}`;
    expect(enRetard).toBeGreaterThan(0);

    const { listerBiens } = await import("@/lib/bienRepository");
    const { listerClients } = await import("@/lib/clientRepository");
    const { chargerContexteOpportunites } = await import("@/lib/opportunites/contexte");
    const { detecterOpportunites } = await import("@/lib/opportunites/moteur");
    const opportunites = detecterOpportunites(
      await chargerContexteOpportunites(
        { biens: await listerBiens(), acquereurs: await listerClients(), tachesActives: [] },
        WORKSPACE_TEST
      ),
      maintenant
    );
    // La visite passée sans compte rendu reste `planifiee` (un CR fait toujours transiter la visite) :
    // c'est la règle d'automatisation `visite_sans_compte_rendu` qui la porte (test suivant), pas le
    // moteur d'opportunités. Celui-ci fait ressortir le pipeline vendeur, un match jamais visité et
    // l'information manquante du bien pivot.
    expect(opportunites.some((o) => o.type === "relance_prospect_vendeur" && o.cible.id === IDS.prospects[0])).toBe(true);
    expect(opportunites.some((o) => o.type === "match_a_exploiter" && o.cible.id === IDS.acquereurs[5])).toBe(true);
    expect(opportunites.some((o) => o.type === "information_a_verifier" && o.cible.id === IDS.biens[0])).toBe(true);
  });

  it("les scanners réels prennent les candidats du scénario : visite de demain (J-1), visite sans compte rendu, offre sans décision, mandat à échéance", async () => {
    const maintenant = new Date();
    await seeder(maintenant);
    const { executerScanTemporelComplet } = await import("@/lib/automatisations/scanTemporel");

    const resultats = await executerScanTemporelComplet(maintenant);
    const parCode = new Map(resultats.map((r) => [r.codeRegle, r]));
    for (const code of ["visite_j_1", "visite_sans_compte_rendu", "offre_sans_decision", "mandat_expire_bientot"] as const) {
      const r = parCode.get(code);
      expect(r?.execute, code).toBe(true);
      if (r?.execute) expect(r.nombreCandidats, code).toBeGreaterThan(0);
    }

    const tachesAuto = await sql`select origine_code, visite_canonique_id, offre_id, bien_id from taches where origine = 'automatique'`;
    expect(tachesAuto.some((t) => t.origine_code === "visite_j_1" && t.visite_canonique_id === IDS.visites.demain)).toBe(true);
    expect(tachesAuto.some((t) => t.origine_code === "visite_sans_compte_rendu" && t.visite_canonique_id === IDS.visites.sansCompteRendu)).toBe(true);
    expect(tachesAuto.some((t) => t.origine_code === "offre_sans_decision" && t.offre_id === IDS.offres.enCours)).toBe(true);
    expect(tachesAuto.some((t) => t.origine_code === "mandat_expire_bientot" && t.bien_id === IDS.biens[2])).toBe(true);

    // Et le seed se rejoue par-dessus ces résidus réels, sans rien laisser.
    const resultat = await seeder(maintenant);
    expect(resultat.statut).toBe("recree");
    expect(await compter("taches")).toBe(COMPTEURS_ATTENDUS.taches);
    expect(await compter("executions_automatisation")).toBe(0);
  });
});

describe("seed-demo — dataset", () => {
  it("n'utilise que des emails de domaine réservé, jamais une adresse délivrable", () => {
    const dataset = construireDataset(new Date("2026-09-01T09:00:00Z"));
    const emails = [...dataset.contacts, ...dataset.acquereurs, ...dataset.prospects].map((x: { email: string }) => x.email);
    expect(emails.length).toBe(24);
    for (const email of emails) expect(email.endsWith("@example.test")).toBe(true);
  });

  it("aucun identifiant Calendar fictif, aucune clé de stockage aléatoire", () => {
    const dataset = construireDataset(new Date("2026-09-01T09:00:00Z"));
    for (const v of dataset.visites) expect((v as { rendezVousCalendarId?: string }).rendezVousCalendarId).toBeUndefined();
    for (const d of dataset.documents) expect(d.cleStockage).toMatch(/^demo-seed-/);
    for (const p of dataset.photos) expect(p.cleStockage).toMatch(/^demo-seed-/);
    for (const b of dataset.bonsVisite) expect(b.signature.signatureCleStockage).toMatch(/^demo-seed-/);
  });
});
