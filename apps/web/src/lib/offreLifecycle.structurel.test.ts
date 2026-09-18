import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// ADR-061 — garanties STRUCTURELLES d'OFFER_LIFECYCLE_FOUNDATION_V1 : migration 0046 additive
// (statuts, motif système, cible offre_id, idempotence, index), transitions centralisées dans un
// seul writer sous verrou du bien, fin du dual-write `biens.offre_en_cours_le`, motif système
// jamais humain, lectures scoped, événements Offre ciblés par offre_id, et tout ce que ce lot ne
// fait PAS (index unique SQL sur acceptee, automatisation, migration acquéreur, UI Offre complète).

const SRC = join(__dirname, "..");
const tables = new Map(
  (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => {
      const config = getTableConfig(t);
      return [config.name, config] as const;
    })
);

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function listerFichiers(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiers(chemin);
    return /\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

const FICHIERS = listerFichiers(SRC);
const relatif = (c: string) => c.replace(SRC + "/", "");
const OFFRES = codeSeul(join(SRC, "lib", "offreRepository.ts"));
const COMPROMIS = codeSeul(join(SRC, "lib", "compromisRepository.ts"));
const SCHEMA_SRC = readFileSync(join(SRC, "db", "schema.ts"), "utf8");

describe("ADR-061 — migration 0046 : additive", () => {
  const offres = tables.get("offres")!;
  const evenements = tables.get("evenements_metier")!;

  it("statuts : en_cours, acceptee, refusee, retiree, caduque ; motif : + autre_offre_acceptee", () => {
    expect(offres.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["offres_statut_check", "offres_motif_perte_check"]));
    expect(SCHEMA_SRC).toMatch(/offres_statut_check", sql`\$\{table\.statut\} IN \('en_cours','acceptee','refusee','retiree','caduque'\)`/);
    expect(SCHEMA_SRC).toMatch(/offres_motif_perte_check[\s\S]{0,300}'autre','autre_offre_acceptee'\)/);
  });

  it("index FK offres_bien_idx / offres_acquereur_idx ; AUCUN index unique sur acceptee (différé §7)", () => {
    expect(offres.indexes.map((i) => i.config.name).sort()).toEqual(["offres_acquereur_idx", "offres_bien_idx"]);
    expect(offres.indexes.every((i) => !i.config.unique)).toBe(true);
    expect(offres.uniqueConstraints).toEqual([]);
    expect(SCHEMA_SRC).not.toMatch(/statut\} = 'acceptee'/);
  });

  it("evenements_metier.offre_id : FK offres NO ACTION, dans le CHECK « une seule cible », index unique (type, offre_id)", () => {
    const fk = evenements.foreignKeys.map((f) => f.reference()).find((r) => r.columns.some((c) => c.name === "offre_id"));
    expect(fk).toBeDefined();
    expect(getTableConfig(fk!.foreignTable).name).toBe("offres");
    expect(evenements.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "offre_id"))!.onDelete ?? "no action").toBe("no action");
    expect(evenements.columns.map((c) => c.name)).not.toContain("workspace_bien_id");
    expect(SCHEMA_SRC).toMatch(/\(case when \$\{table\.offreId\} is not null then 1 else 0 end\)/);
    expect(evenements.indexes.map((i) => i.config.name)).toContain("evenements_metier_offre_unique");
    expect(SCHEMA_SRC).toMatch(/evenements_metier_type_check[\s\S]{0,600}'offre_recue','offre_acceptee','offre_refusee','offre_retiree','offre_caduque',\s*'compromis_realise','compromis_annule'/);
  });

  it("aucun workspace_id sur offres/compromis, aucune colonne tâche ajoutée (offre_id / compromis_id existaient), migration sans backfill", () => {
    for (const t of ["offres", "compromis"]) expect(tables.get(t)!.columns.map((c) => c.name)).not.toContain("workspace_id");
    expect(tables.get("taches")!.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["offre_id", "compromis_id"]));
    const sql = readFileSync(join(SRC, "db", "migrations", "0046_offer_lifecycle.sql"), "utf8").replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\b/m);
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE/);
    const migrations = readdirSync(join(SRC, "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(migrations[migrations.length - 1]).toBe("0046_offer_lifecycle.sql");
  });
});

describe("ADR-061 — writers : un moteur de transition, verrou du bien, UPDATE conditionnel", () => {
  it("un seul UPDATE de statut d'offre en production, dans deciderOffre, conditionné par le statut attendu", () => {
    const fautifs = FICHIERS.filter((c) => c !== join(SRC, "lib", "offreRepository.ts")).filter((c) => /update\(\s*offresTable\s*\)/.test(codeSeul(c)));
    expect(fautifs.map(relatif)).toEqual([]);
    const decider = OFFRES.slice(OFFRES.indexOf("export async function deciderOffre("), OFFRES.indexOf("\nexport ", OFFRES.indexOf("export async function deciderOffre(") + 1));
    expect(decider).toContain("verrouillerBienPourOffres(cible.bienId, workspaceId, tx)");
    expect(decider.indexOf("verrouillerBienPourOffres(")).toBeLessThan(decider.indexOf('.for("update")'));
    expect(decider).toContain("eq(offresTable.statut, statutActuel)");
    expect(decider).toContain('eq(offresTable.statut, "en_cours")');
    expect(decider).toContain("transitionOffreAutorisee(statutActuel, transition.statut)");
    expect(decider).toContain(".orderBy(asc(offresTable.id))");
    expect(decider).toContain('statut: "acceptation_active_existante"');
    expect(decider).toContain("motifPerte: MOTIF_PERTE_SYSTEME");
    // Les quatre gestes passent par le même moteur.
    for (const w of ["accepterOffre", "refuserOffre", "retirerOffre", "rendreOffreCaduque"]) {
      expect(OFFRES).toMatch(new RegExp(`export function ${w}\\([^)]*\\)\\s*\\{\\s*return deciderOffre\\(`));
    }
  });

  it("le verrou du bien est scoped par le workspace de session", () => {
    const verrou = OFFRES.slice(OFFRES.indexOf("export async function verrouillerBienPourOffres("), OFFRES.indexOf("\nasync function acquereurDuWorkspace("));
    expect(verrou).toContain("eq(biensTable.workspaceId, workspaceId)");
    expect(verrou).toContain('.for("update")');
  });

  it("le domaine Offre n'écrit plus biens.offre_en_cours_le : marquerOffreEnCours n'est appelé que par l'action legacy", () => {
    const appelants = FICHIERS.filter((c) => /\bmarquerOffreEnCours\(/.test(codeSeul(c))).map(relatif).sort();
    expect(appelants).toEqual(["actions/statutCommercialBien.ts", "lib/bienRepository.ts"]);
    // Le repository LIT `offreEnCoursLe` pour le mode legacy (§11), mais ne l'écrit jamais.
    expect(OFFRES).not.toMatch(/marquerOffreEnCours|update\(\s*biensTable|set\(\{[^}]*offreEnCoursLe/);
    const legacy = codeSeul(join(SRC, "actions", "statutCommercialBien.ts"));
    expect(legacy).toContain("if (await existeOffreCanoniqueDuBien(id, workspaceId)) redirect(`/biens/${id}`);");
    expect(legacy.match(/existeOffreCanoniqueDuBien\(id, workspaceId\)/g)).toHaveLength(2);
    expect(legacy.match(/listerCompromisPourBien\(id, workspaceId\)\)\.length > 0\) redirect/g)).toHaveLength(2);
  });

  it("le motif système n'est jamais humain : type MotifPerteHumain dans les transitions, MOTIFS_PERTE_HUMAINS dans l'UI, action filtrante", () => {
    expect(OFFRES).toMatch(/motifPerte: MotifPerteHumain/);
    expect(codeSeul(join(SRC, "actions", "offre.ts"))).toContain("estMotifPerteHumain(motifPerteBrut)");
    const ui = FICHIERS.filter((c) => (c.includes(join("src", "components")) || c.includes(join("src", "app"))) && /MOTIFS_PERTE\b/.test(codeSeul(c)));
    expect(ui.map(relatif), "l'UI ne propose que MOTIFS_PERTE_HUMAINS").toEqual([]);
  });

  it("chaque événement Offre cible offre_id et est émis par le repository, dans la transaction", () => {
    const emissions = OFFRES.match(/typeEvenement: [^}]*offreId/g) ?? [];
    expect(emissions.length).toBeGreaterThanOrEqual(3);
    const actions = codeSeul(join(SRC, "actions", "offre.ts"));
    expect(actions).not.toMatch(/emettreEvenementEtPreparerExecutions|@\/db\//);
    const repo = codeSeul(join(SRC, "lib", "automatisations", "evenementMetierRepository.ts"));
    expect(repo).toContain('"offreId" in input');
  });

  it("compromis : transitions sous verrou du bien + UPDATE conditionnel, événements realise/annule ; création scoped", () => {
    expect(COMPROMIS).toContain('{ typeEvenement: transition.statut === "realise" ? "compromis_realise" : "compromis_annule", compromisId }');
    expect(COMPROMIS.match(/verrouillerBienPourOffres\(/g)!.length).toBeGreaterThanOrEqual(3);
    expect(COMPROMIS.match(/eq\(compromisTable\.statut, "en_cours"\)/g)!.length).toBeGreaterThanOrEqual(3);
    const fautifs = FICHIERS.filter((c) => c !== join(SRC, "lib", "compromisRepository.ts")).filter((c) => /(update|insert)\(\s*compromisTable\s*\)/.test(codeSeul(c)));
    expect(fautifs.map(relatif)).toEqual([]);
    // L'annulation ne touche jamais l'offre.
    expect(COMPROMIS).not.toMatch(/update\(\s*offresTable/);
  });
});

describe("ADR-061 — lectures scoped et statut commercial", () => {
  it("toute lecture Offre/Compromis exige un workspaceId (jointure biens.workspace_id)", () => {
    for (const [code, fonctions] of [
      [OFFRES, ["getOffreById", "listerOffresPourBien", "listerOffresPourAcquereur", "listerOffresEnCoursPourPaire", "existeOffreCanoniqueDuBien", "chargerEtatOffresBien", "chargerEtatsOffresParBien"]],
      [COMPROMIS, ["getCompromisById", "listerCompromisPourBien", "listerCompromisPourAcquereur", "getCompromisParOffreId", "listerCompromisParBiens"]],
    ] as const) {
      for (const f of fonctions) {
        const debut = code.indexOf(`export async function ${f}(`);
        expect(debut, f).toBeGreaterThanOrEqual(0);
        const corps = code.slice(debut, code.indexOf("\nexport ", debut + 1));
        expect(corps, f).toMatch(/workspaceId: string/);
        expect(corps, f).toMatch(/biensTable\.workspaceId, workspaceId|listerOffresPourBien\(bien\.id, workspaceId/);
      }
    }
    expect(OFFRES).not.toMatch(/getDb\(\)\s*\.\s*select/);
    expect(COMPROMIS).not.toMatch(/getDb\(\)\s*\.\s*select/);
  });

  it("une seule règle de statut commercial : statutCommercialBienEffectif, priorité vendu > compromis > offre_acceptee > offre_en_cours", () => {
    const statut = codeSeul(join(SRC, "lib", "statutCommercialBien.ts"));
    expect(statut).not.toContain("export function deriverStatutCommercial");
    expect(statut.indexOf('return "vendu"')).toBeLessThan(statut.indexOf('return "compromis_signe"'));
    expect(statut.indexOf('return "compromis_signe"')).toBeLessThan(statut.indexOf('return "offre_acceptee"'));
    expect(statut.indexOf('return "offre_acceptee"')).toBeLessThan(statut.indexOf('return "offre_en_cours"'));
    // Le legacy n'est lu qu'en absence totale d'offre canonique.
    expect(statut).toContain("if (offres.length > 0) {");
    expect(statut.indexOf("if (offres.length > 0) {")).toBeLessThan(statut.indexOf("if (bien.offreEnCoursLe)"));
    const consommateurs = FICHIERS.filter((c) => /deriverStatutCommercial\(/.test(codeSeul(c)));
    expect(consommateurs.map(relatif)).toEqual([]);
  });

  it("la liste des biens calcule le statut en lot (jamais mandatCourant/offres par ligne)", () => {
    const liste = codeSeul(join(SRC, "app", "biens", "page.tsx"));
    expect(liste).toContain("chargerEtatsOffresParBien(biens, workspaceId)");
    expect(liste).toContain("listerCompromisParBiens(biens.map((b) => b.id), workspaceId)");
    expect(liste).not.toMatch(/listerOffresPourBien\(|listerCompromisPourBien\(/);
  });
});

describe("ADR-061 — hors périmètre du lot", () => {
  it("aucune automatisation Offre/Compromis nouvelle, aucune migration acquéreur, aucune route nouvelle", () => {
    const catalogue = codeSeul(join(SRC, "lib", "automatisations", "catalogueRegles.ts"));
    expect(catalogue).not.toMatch(/typeEvenement: "(offre_recue|offre_acceptee|offre_refusee|offre_retiree|offre_caduque|compromis_realise|compromis_annule)"/);
    for (const t of ["offres", "compromis"]) {
      expect(tables.get(t)!.columns.map((c) => c.name), t).not.toContain("contact_id");
      expect(tables.get(t)!.columns.map((c) => c.name), t).not.toContain("projet_acquereur_id");
    }
    expect([...tables.keys()]).not.toContain("parties_offre");
    const pages = listerFichiers(join(SRC, "app")).filter((c) => /\/page\.tsx$/.test(c) && /offres|compromis/.test(relatif(c)));
    expect(pages.map(relatif).sort()).toEqual(["app/compromis/nouveau/page.tsx", "app/offres/nouveau/page.tsx"]);
  });

  it("les primitives basses (enregistrerOffre, enregistrerCompromis, marquerCompromisRealise/Annule) n'ont aucun appelant de production hors repository", () => {
    for (const [prim, repo] of [
      ["enregistrerOffre", "lib/offreRepository.ts"],
      ["enregistrerCompromis", "lib/compromisRepository.ts"],
      ["marquerCompromisRealise", "lib/compromisRepository.ts"],
      ["marquerCompromisAnnule", "lib/compromisRepository.ts"],
    ] as const) {
      const appelants = FICHIERS.filter((c) => new RegExp(`\\b${prim}\\(`).test(codeSeul(c))).map(relatif);
      expect(appelants, prim).toEqual([repo]);
    }
  });
});
