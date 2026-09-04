import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";

// VALUE-07B (ADR-053) — FRONTIÈRE « AFFICHÉ ≠ RÉDIGÉ ». Le lot VALUE-06 interdisait toute sortie ;
// celui-ci en ouvre exactement une, l'affichage au conseiller, et doit prouver que les autres
// restent fermées. Ces tests tiennent donc les deux affirmations EN MÊME TEMPS sur un seul et même
// repère réel : visible du conseiller, invisible du moteur de rédaction.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// Marqueur volontairement absurde : une correspondance accidentelle est impossible.
const SENTINELLE = "SENTINELLE_REPERE_NE_DOIT_JAMAIS_ATTEINDRE_IA";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, reperesRelationnelsAcquereur: reperesTable } = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerRepereRelationnelAcquereur, listerReperesRelationnelsAcquereur } = await import(
  "@/lib/repereRelationnelRepository"
);
const { selectionnerReperesPourCommunication } = await import("@/lib/relations/politiqueReperesCommunication");
const { construireRepriseContactAcquereur } = await import("./repriseContactAcquereur");
const { assemblerFaits } = await import("./contexteCommunication");
const { genererBrouillonEmail } = await import("./genererBrouillonEmail");
const { projeterFaitsAutorises } = await import("@/lib/redaction/contrat");
const { construirePromptUtilisateur, PROMPT_SYSTEME } = await import("@/lib/redaction/prompt");
const { validerReformulation } = await import("@/lib/redaction/gardeFous");
const ReperesPourEchange = (await import("@/components/communications/ReperesPourEchange")).default;
const BrouillonEmailFormulaire = (await import("@/components/communications/BrouillonEmailFormulaire")).default;

const idsAcquereurs: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    await getDb().delete(reperesTable).where(inArray(reperesTable.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
});

// Le pire cas du lot : un centre d'intérêt, provenance la plus « forte » possible, autorisé, actif.
// Même dans cette configuration, aucun chemin ne mène au fournisseur. Monté UNE fois : les tests
// ci-dessous lisent tous la même situation, aucun ne la modifie.
let acquereur: Awaited<ReturnType<typeof creerAcquereur>>;

beforeAll(async () => {
  acquereur = await creerAcquereur({
    prenom: "Camille",
    nom: "[test réel] Frontière VALUE-07B",
    email: "frontiere.value07b@example.com",
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
});

const CANDIDAT_SENTINELLE = (id: string) =>
  ({ type: "acquereur", id, nom: "[test réel] Frontière VALUE-07B", prenom: "Camille" }) as const;

// Faits réalistes d'un suivi de visite : c'est ce que la chaîne de rédaction a réellement le droit
// de connaître, et rien d'autre ne doit s'y ajouter.
const FAITS_PARTIELS = {
  bienAdresse: "14 rue des Tilleuls Fictifs",
  dateVisite: "31 août 2026",
  interetVisite: "Intéressé",
};

describe("VALUE-07B — le repère est visible du conseiller", () => {
  it("la politique rend le repère affichable et le bloc serveur l'affiche", async () => {
    const reperes = await listerReperesRelationnelsAcquereur(acquereur.id);

    const { reperesAffichables, presencePreferenceContact } = selectionnerReperesPourCommunication(
      CANDIDAT_SENTINELLE(acquereur.id),
      reperes
    );

    expect(reperesAffichables).toHaveLength(1);
    // `centre_interet` : le signal de préférence de contact reste bas.
    expect(presencePreferenceContact).toBe(false);

    const html = renderToStaticMarkup(
      <ReperesPourEchange reperes={reperesAffichables} presencePreferenceContact={presencePreferenceContact} />
    );

    expect(html).toContain(SENTINELLE);
    expect(html).toContain("Repères pour cet échange");
    // La provenance est rendue pour que le conseiller apprécie l'origine de l'information.
    expect(html).toContain("Indiqué par le client");
    // Aucun vocabulaire d'automatisation : rien n'est utilisé, le bloc ne doit pas le laisser
    // croire. Assertion portée sur l'habillage seul — le libellé du repère appartient au
    // conseiller et n'a pas à éviter un vocabulaire.
    const habillage = html.split(SENTINELLE).join("");
    for (const mensonge of ["IA", "automatique", "pris en compte", "personnalis"]) {
      expect(habillage).not.toContain(mensonge);
    }
  });

  it("le bloc ne rend rien quand aucun repère n'est affichable", () => {
    expect(renderToStaticMarkup(<ReperesPourEchange reperes={[]} presencePreferenceContact={false} />)).toBe("");
  });
});

describe("VALUE-07B — le repère n'atteint jamais la chaîne de rédaction", () => {
  it("la sentinelle n'entre ni dans la projection VALUE-04, ni dans les faits, ni dans le brouillon", () => {
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

    const faits = assemblerFaits(CANDIDAT_SENTINELLE(acquereur.id), FAITS_PARTIELS);
    expect(JSON.stringify(faits)).not.toContain(SENTINELLE);

    const brouillon = genererBrouillonEmail("suivi_visite", faits, "professionnel");
    expect(`${brouillon.objet}\n${brouillon.corps}`).not.toContain(SENTINELLE);
  });

  it("la sentinelle n'entre ni dans les faits autorisés, ni dans le contexte transmis au fournisseur, ni dans le prompt", () => {
    const faits = assemblerFaits(CANDIDAT_SENTINELLE(acquereur.id), FAITS_PARTIELS);
    const brouillon = genererBrouillonEmail("suivi_visite", faits, "professionnel");

    const contexte = {
      ton: "professionnel" as const,
      destinataireEstProprietaire: false,
      objetActuel: brouillon.objet,
      corpsActuel: brouillon.corps,
      faitsAutorises: projeterFaitsAutorises(faits),
    };

    expect(JSON.stringify(contexte)).not.toContain(SENTINELLE);
    expect(PROMPT_SYSTEME).not.toContain(SENTINELLE);
    expect(construirePromptUtilisateur(contexte)).not.toContain(SENTINELLE);
  });

  it("la sentinelle n'entre pas dans le corpus des garde-fous : une sortie qui la contiendrait est rejetée", () => {
    const faits = assemblerFaits(CANDIDAT_SENTINELLE(acquereur.id), FAITS_PARTIELS);
    const brouillon = genererBrouillonEmail("suivi_visite", faits, "professionnel");
    const contexte = {
      ton: "professionnel" as const,
      destinataireEstProprietaire: false,
      objetActuel: brouillon.objet,
      corpsActuel: brouillon.corps,
      faitsAutorises: projeterFaitsAutorises(faits),
    };

    // `corpusAutorise()` est construit UNIQUEMENT depuis ce contexte : si la sentinelle en était,
    // elle deviendrait un contenu légitime en sortie. Le rejet prouve qu'elle n'y est pas —
    // ajouter un libellé de repère aux faits élargirait mécaniquement ce corpus.
    expect(validerReformulation(contexte, brouillon.objet, brouillon.corps).valide).toBe(true);
    expect(validerReformulation(contexte, brouillon.objet, `${brouillon.corps}\n${SENTINELLE}`).valide).toBe(false);
  });
});

describe("VALUE-07B — frontière serveur / client", () => {
  it("le formulaire de rédaction ne rend aucune trace du repère, y compris dans ses champs cachés", () => {
    const faits = assemblerFaits(CANDIDAT_SENTINELLE(acquereur.id), FAITS_PARTIELS);

    // Rendu avec la reformulation ACTIVE : c'est la configuration qui produit les champs cachés
    // envoyés à `reformulerBrouillonAction`.
    const html = renderToStaticMarkup(
      <BrouillonEmailFormulaire
        intention="suivi_visite"
        faits={faits}
        destinataireEmail="frontiere.value07b@example.com"
        gmailAutorise
        destinataireCandidatType="acquereur"
        destinataireCandidatId={acquereur.id}
        redactionDisponible
        parametresEcran={{ acquereurId: acquereur.id }}
      />
    );

    expect(html).not.toContain(SENTINELLE);
  });

  it("la page ne passe aucun repère au formulaire de rédaction", () => {
    const source = readFileSync(join(__dirname, "../../app/communications/nouveau/page.tsx"), "utf8");

    // Le composant SERVEUR d'affichage, lui, reçoit bien les repères : la frontière testée n'est
    // pas « le mot repère est interdit dans la page », c'est « affichage serveur ≠ rédaction ».
    expect(source).toContain("<ReperesPourEchange");

    const appelFormulaire = source.slice(source.indexOf("<BrouillonEmailFormulaire"));
    expect(appelFormulaire.slice(0, appelFormulaire.indexOf("/>")).toLowerCase()).not.toContain("repere");
  });

  it("ni la reformulation ni l'envoi Gmail ne connaissent les repères", () => {
    for (const chemin of ["../../actions/reformulerBrouillon.ts", "../../actions/envoyerEmailGmail.ts"]) {
      const source = readFileSync(join(__dirname, chemin), "utf8").toLowerCase();
      expect(source).not.toContain("repere");
      expect(source).not.toContain("utilisablecommunication");
    }
  });
});
