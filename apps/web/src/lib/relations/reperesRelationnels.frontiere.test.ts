import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";

// VALUE-06 — FRONTIÈRE. Ce lot prépare la donnée relationnelle ; il ne la consomme nulle part.
// Ces tests fixent cette limite là où elle compte : la mémoire relationnelle (VALUE-03), la
// projection communicationnelle (VALUE-04) et la rédaction assistée (VALUE-05) doivent se comporter
// EXACTEMENT comme avant, y compris quand un repère est explicitement marqué utilisable.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// Marqueur volontairement absurde : une correspondance accidentelle est impossible.
const SENTINELLE = "SENTINELLE_PERSONNELLE_NE_DOIT_PAS_SORTIR";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, reperesRelationnelsAcquereur: reperesTable } = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerRepereRelationnelAcquereur, listerReperesRelationnelsAcquereur } = await import(
  "@/lib/repereRelationnelRepository"
);
const { construireMemoireRelationnelleAcquereur } = await import("./memoireAcquereur");
const { construireRepriseContactAcquereur } = await import("@/lib/communications/repriseContactAcquereur");
const { projeterFaitsAutorises } = await import("@/lib/redaction/contrat");
const { construirePromptUtilisateur, PROMPT_SYSTEME } = await import("@/lib/redaction/prompt");
const FicheClient = (await import("@/app/clients/[id]/page")).default;

const idsAcquereurs: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    await getDb().delete(reperesTable).where(inArray(reperesTable.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
});

// Acquéreur réel portant un repère AUTORISÉ en communication et contenant la sentinelle : le pire
// cas possible pour ce lot.
async function acquereurAvecRepereSentinelle() {
  const acquereur = await creerAcquereur({
    prenom: "Camille",
    nom: "[test réel] Frontière repères",
    email: "frontiere.reperes@example.com",
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  await creerRepereRelationnelAcquereur({
    acquereurId: acquereur.id,
    categorie: "centre_interet",
    libelle: SENTINELLE,
    provenance: "indique_par_le_client",
    utilisableCommunication: true,
  });
  return acquereur;
}

describe("VALUE-03 — la mémoire relationnelle ignore les repères", () => {
  it("un repère actif et autorisé n'apparaît jamais dans la mémoire construite", async () => {
    const acquereur = await acquereurAvecRepereSentinelle();
    const memoire = construireMemoireRelationnelleAcquereur({
      acquereur,
      secteurs: [],
      visites: [],
      comptesRendus: [],
      offres: [],
      compromis: [],
      tachesLiees: [],
      envois: [],
      opportunites: [],
      biensParId: new Map(),
      aujourdHui: "2026-09-03",
    });

    expect(JSON.stringify(memoire)).not.toContain(SENTINELLE);
    // Le repère existe pourtant bien, et il est bien actif : c'est la séparation qui est testée,
    // pas une absence de donnée.
    expect(await listerReperesRelationnelsAcquereur(acquereur.id)).toHaveLength(1);
  });

  it("« À retenir » reste alimenté par les seuls faits structurés du projet immobilier", () => {
    const source = readFileSync(join(__dirname, "memoireAcquereur.ts"), "utf8");
    expect(source).not.toContain("repereRelationnel");
    expect(source).not.toContain("RepereRelationnel");
  });
});

describe("VALUE-04 — projection communicationnelle strictement inchangée", () => {
  it("la liste blanche des faits partageables n'a pas été élargie", () => {
    const source = readFileSync(join(__dirname, "../communications/repriseContactAcquereur.ts"), "utf8");
    const declaration = source.slice(source.indexOf("export type FaitsPartageablesAcquereur"));
    const champs = declaration.slice(0, declaration.indexOf(">;"));
    expect(champs).toContain('"bienAdresse" | "dateVisite" | "interetVisite" | "criteresCompatibles"');
    expect(source).not.toContain("repereRelationnel");
    expect(source).not.toContain("RepereRelationnel");
  });

  it("la reprise construite pour un acquéreur porteur d'un repère autorisé ne le contient jamais", async () => {
    const acquereur = await acquereurAvecRepereSentinelle();
    const reprise = construireRepriseContactAcquereur({
      acquereur,
      visites: [],
      comptesRendus: [],
      offres: [],
      compromis: [],
      compatibilites: [],
      opportunites: [],
      tachesActives: [],
      biens: [],
    });

    expect(JSON.stringify(reprise ?? null)).not.toContain(SENTINELLE);
  });
});

describe("VALUE-05 — le fournisseur ne reçoit aucun repère", () => {
  it("la liste blanche de rédaction n'a pas été élargie", () => {
    const source = readFileSync(join(__dirname, "../redaction/contrat.ts"), "utf8");
    expect(source).not.toContain("repereRelationnel");
    expect(source).not.toContain("RepereRelationnel");
    expect(source).not.toContain("utilisableCommunication");
  });

  it("la projection des faits autorisés rend exactement les mêmes champs qu'avant VALUE-06", () => {
    const faitsAutorises = projeterFaitsAutorises({
      destinataireNom: "Durand",
      destinatairePrenom: "Camille",
      bienAdresse: "14 rue des Tilleuls Fictifs",
      dateVisite: "31 août 2026",
      interetVisite: "Intéressé",
      criteresCompatibles: ["votre budget"],
    });

    expect(Object.keys(faitsAutorises).sort()).toEqual([
      "bienAdresse",
      "criteresCompatibles",
      "dateVisite",
      "destinatairePrenom",
      "interetVisite",
    ]);
  });

  it("la sentinelle n'atteint ni le prompt système, ni le prompt utilisateur", () => {
    const contexte = {
      ton: "professionnel" as const,
      destinataireEstProprietaire: false,
      objetActuel: "Suite à votre visite",
      corpsActuel: "Bonjour Camille,\n\nSuite à votre visite du 31 août 2026.\n\nCordialement,",
      faitsAutorises: projeterFaitsAutorises({
        destinatairePrenom: "Camille",
        bienAdresse: "14 rue des Tilleuls Fictifs",
        dateVisite: "31 août 2026",
        interetVisite: "Intéressé",
      }),
    };

    expect(PROMPT_SYSTEME).not.toContain(SENTINELLE);
    expect(construirePromptUtilisateur(contexte)).not.toContain(SENTINELLE);
    // Aucun champ du contexte ne peut structurellement porter un repère : `FaitsAutorisesRedaction`
    // est un `Pick` fermé, et la sentinelle n'a aucun chemin pour y entrer.
    expect(JSON.stringify(contexte)).not.toContain(SENTINELLE);
  });
});

describe("VALUE-06 — les textes libres existants ne sont jamais migrés", () => {
  it("un acquéreur dont les notes et critères contiennent des informations n'obtient aucun repère", async () => {
    const acquereur = await creerAcquereur({
      prenom: "Camille",
      nom: "[test réel] Notes non migrées",
      email: "notes.non.migrees@example.com",
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: ["Aime le football", "Préfère être contacté par email"],
      stadeProjet: "decouverte",
      notes: "Camille m'a dit qu'elle préférait les échanges par email et qu'elle aimait la randonnée.",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereurs.push(acquereur.id);

    // Aucune extraction, aucune suggestion, aucun repère implicite : seule une création explicite
    // du conseiller produit une ligne.
    expect(await listerReperesRelationnelsAcquereur(acquereur.id)).toHaveLength(0);
  });

  it("la fiche rend les repères actifs dans leur propre section, jamais dans « À retenir »", async () => {
    const acquereur = await acquereurAvecRepereSentinelle();
    const html = renderToStaticMarkup(
      await FicheClient({ params: Promise.resolve({ id: acquereur.id }), searchParams: Promise.resolve({}) })
    );

    expect(html).toContain("Repères relationnels");
    expect(html).toContain(SENTINELLE);

    // Le repère est rendu APRÈS le bloc « À retenir » de la mémoire : les deux concepts restent
    // visuellement et structurellement distincts, jamais fusionnés dans un même tableau de faits.
    const positionARetenir = html.indexOf("À retenir");
    const positionSection = html.indexOf("Repères relationnels");
    const positionSentinelle = html.indexOf(SENTINELLE);
    expect(positionARetenir).toBeGreaterThan(-1);
    expect(positionSection).toBeGreaterThan(positionARetenir);
    expect(positionSentinelle).toBeGreaterThan(positionSection);
  });

  it("la page acquéreur transmet les repères au seul composant qui les affiche", () => {
    const source = readFileSync(join(__dirname, "../../app/clients/[id]/page.tsx"), "utf8");
    // Lus une fois, passés une fois : jamais injectés dans la mémoire ni dans la reprise.
    expect(source).toContain("reperesInitiaux={reperesRelationnels}");
    const appelMemoire = source.slice(source.indexOf("construireMemoireRelationnelleAcquereur({"));
    expect(appelMemoire.slice(0, appelMemoire.indexOf("});"))).not.toContain("reperes");
    const appelReprise = source.slice(source.indexOf("construireRepriseContactAcquereur({"));
    expect(appelReprise.slice(0, appelReprise.indexOf("});"))).not.toContain("reperes");
  });
});
