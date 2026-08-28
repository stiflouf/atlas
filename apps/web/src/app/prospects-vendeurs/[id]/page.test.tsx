import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray, like } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  prospectsVendeurs: prospectsVendeursTable,
  biens: biensTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  taches: tachesTable,
} = await import("@/db/schema");
const {
  creerProspectVendeur,
  qualifierProspectVendeur,
  enregistrerEstimationProspectVendeur,
  planifierRdvEstimationProspectVendeur,
  marquerRdvEstimationRealiseProspectVendeur,
  proposerMandatProspectVendeur,
  signerMandatProspectVendeur,
  marquerProspectVendeurPerdu,
} = await import("@/lib/prospectVendeurRepository");
const { ajouterNoteProspectVendeur } = await import("@/lib/noteProspectVendeurRepository");
const FicheProspectVendeur = (await import("./page")).default;

const NOM_PREFIX = "[test réel] COCKPIT-Vendeur";
const idsProspects: string[] = [];
const idsBiens: string[] = [];

afterAll(async () => {
  // evenements_metier ne cascade jamais depuis sa source (ADR-032, append-only) : à purger avant
  // le prospect, sinon la suppression viole la clé étrangère.
  if (idsProspects.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length > 0) {
      await getDb()
        .delete(executionsAutomatisationTable)
        .where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
    await getDb().delete(tachesTable).where(inArray(tachesTable.prospectVendeurId, idsProspects));
  }
  await getDb().delete(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `${NOM_PREFIX}%`));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function prospectDeTest(suffixe: string, champs: Partial<Parameters<typeof creerProspectVendeur>[0]> = {}) {
  const prospect = await creerProspectVendeur({
    nom: `${NOM_PREFIX}-${suffixe}`,
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
    ...champs,
  });
  idsProspects.push(prospect.id);
  return prospect;
}

async function rendre(id: string, searchParams: Record<string, string> = {}) {
  const element = await FicheProspectVendeur({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

describe("Fiche prospect vendeur — prochaine étape (une seule action primaire)", () => {
  it("un prospect neuf propose la qualification, jamais la signature du mandat", async () => {
    const prospect = await prospectDeTest("NEUF");
    const html = await rendre(prospect.id);

    expect(html).toContain("Prochaine étape");
    expect(html).toContain("Qualifier le prospect");
    // Le défaut corrigé par la proposition 2 : aucun CTA de jalon futur ne domine la page. La
    // signature ne reste atteignable que sous « Corriger un jalon ».
    expect(html).not.toContain("Signer le mandat et créer le bien</p>");
  });

  it("mandat proposé : la signature devient l'action primaire", async () => {
    const prospect = await prospectDeTest("MANDAT-PROPOSE");
    await proposerMandatProspectVendeur(prospect.id);
    const html = await rendre(prospect.id);

    expect(html).toContain("Signer le mandat et créer le bien");
    expect(html).toContain(`/prospects-vendeurs/${prospect.id}/signer-mandat`);
  });

  it("perdu : aucune prochaine étape, le motif réel est affiché", async () => {
    const prospect = await prospectDeTest("PERDU");
    await marquerProspectVendeurPerdu(prospect.id, "choix_agence_concurrente", "2026-08-06");
    const html = await rendre(prospect.id);

    expect(html).not.toContain("Prochaine étape");
    expect(html).toContain("A choisi une agence concurrente");
    expect(html).toContain("aucun jalon ne peut plus être posé");
  });

  it("toutes les commandes de jalon restent atteignables sous « Corriger un jalon »", async () => {
    const prospect = await prospectDeTest("CORRIGER");
    const html = await rendre(prospect.id);

    expect(html).toContain("Corriger un jalon");
    expect(html).toContain("Planifier le rendez-vous");
    expect(html).toContain("Marquer le rendez-vous réalisé");
    expect(html).toContain("Enregistrer une estimation");
    expect(html).toContain("Marquer le mandat proposé");
    expect(html).toContain("Aucune séquence n&#x27;est imposée");
  });
});

describe("Fiche prospect vendeur — rail de progression", () => {
  it("affiche les six jalons dans l'ordre réellement implémenté", async () => {
    const prospect = await prospectDeTest("RAIL");
    const html = await rendre(prospect.id);

    const positions = ["Prospect", "Qualifié", "RDV estimation", "Estimation", "Mandat proposé", "Mandat signé"].map(
      (libelle) => html.indexOf(`>${libelle}<`)
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("n'invente aucune date pour un jalon non atteint", async () => {
    const prospect = await prospectDeTest("SANS-DATES");
    const html = await rendre(prospect.id);

    // Cinq jalons non franchis et non planifiés : cinq tirets, jamais une date fabriquée.
    expect(html.split("—").length - 1).toBeGreaterThanOrEqual(5);
  });

  it("affiche une date de rendez-vous seulement PRÉVUE sans marquer le jalon franchi", async () => {
    const prospect = await prospectDeTest("RDV-PREVU");
    await qualifierProspectVendeur(prospect.id);
    await planifierRdvEstimationProspectVendeur(prospect.id, new Date("2026-07-29T12:30:00.000Z"));
    const html = await rendre(prospect.id);

    expect(html).toContain("prévu ");
    expect(html).toContain("Marquer le rendez-vous d&#x27;estimation réalisé");
  });
});

describe("Fiche prospect vendeur — projet de vente", () => {
  it("n'assimile jamais un secteur approximatif à une adresse précise", async () => {
    const prospect = await prospectDeTest("SECTEUR", { secteurBienPotentiel: "Quartier Thabor" });
    const html = await rendre(prospect.id);

    expect(html).toContain("Quartier Thabor");
    expect(html).toContain("Secteur approximatif");
  });

  it("une adresse précise n'affiche jamais la mention de secteur approximatif", async () => {
    const prospect = await prospectDeTest("ADRESSE", {
      adresseBienPotentiel: "12 rue des Tilleuls",
      secteurBienPotentiel: "Quartier Thabor",
      ville: "Cesson-Sévigné",
      codePostal: "35510",
    });
    const html = await rendre(prospect.id);

    expect(html).toContain("12 rue des Tilleuls");
    expect(html).not.toContain("Secteur approximatif");
  });

  it("labellise le type de bien au lieu d'afficher la valeur de base", async () => {
    const prospect = await prospectDeTest("TYPE", { typeBien: "local_commercial" });
    const html = await rendre(prospect.id);

    expect(html).toContain("Local commercial");
    expect(html).not.toContain(">local_commercial<");
  });

  it("dit qu'aucune estimation n'existe plutôt que d'afficher un montant nul", async () => {
    const prospect = await prospectDeTest("SANS-ESTIMATION");
    const html = await rendre(prospect.id);

    expect(html).toContain("Pas encore chiffrée");
    expect(html).not.toContain("0 €");
  });
});

describe("Fiche prospect vendeur — état incomplet", () => {
  it("liste uniquement des champs réellement éditables et renvoie vers le formulaire existant", async () => {
    const prospect = await prospectDeTest("INCOMPLET");
    const html = await rendre(prospect.id);

    expect(html).toContain("Aucune coordonnée renseignée");
    expect(html).toContain("À compléter");
    expect(html).toContain("Téléphone ou email");
    expect(html).toContain("Type de bien");
    expect(html).toContain(`/prospects-vendeurs/${prospect.id}/modifier`);
    // Jamais un pourcentage ni un score de complétion.
    expect(html).not.toContain("%");
  });

  it("un prospect jamais contacté le dit, sans compteur de jours trompeur", async () => {
    const prospect = await prospectDeTest("JAMAIS-CONTACTE");
    const html = await rendre(prospect.id);

    expect(html).toContain("jamais contacté");
  });
});

describe("Fiche prospect vendeur — journal", () => {
  it("fusionne jalons réels et notes réelles dans un seul fil", async () => {
    const prospect = await prospectDeTest("JOURNAL");
    await qualifierProspectVendeur(prospect.id);
    await ajouterNoteProspectVendeur(prospect.id, "appel", "Rappel effectué, rendez-vous à caler.");
    const html = await rendre(prospect.id);

    expect(html).toContain("Parcours et échanges");
    expect(html).toContain("Prospect qualifié");
    expect(html).toContain("Opportunité créée");
    expect(html).toContain("Rappel effectué, rendez-vous à caler.");
  });

  it("les raccourcis de journal ne prétendent jamais envoyer un message", async () => {
    const prospect = await prospectDeTest("WORDING");
    const html = await rendre(prospect.id);

    expect(html).toContain("Noter un échange");
    expect(html).toContain("n&#x27;envoie aucun message");
    // Aucun envoi Gmail direct vendeur : le seul chemin réel passe par une tâche.
    expect(html).not.toContain("Envoyer un email");
    expect(html).not.toContain("Envoyer un SMS");
  });

  it("assume explicitement de ne pas être un journal d'audit", async () => {
    const prospect = await prospectDeTest("PAS-AUDIT");
    const html = await rendre(prospect.id);

    expect(html).toContain("corriger une date déplace l&#x27;entrée");
  });

  it("compte les échanges réellement enregistrés, jamais des relances déduites", async () => {
    const prospect = await prospectDeTest("COMPTE");
    await ajouterNoteProspectVendeur(prospect.id, "appel", "Premier échange.");
    await ajouterNoteProspectVendeur(prospect.id, "note_interne", "Remarque interne, pas un échange.");
    const html = await rendre(prospect.id);

    expect(html).toContain("Échanges enregistrés");
    expect(html).toContain("Notes internes");
    expect(html).not.toContain("relances");
  });
});

describe("Fiche prospect vendeur — cohérence temporelle du rendez-vous", () => {
  it("affiche la date réellement persistée du rendez-vous tenu, jamais celle qui était prévue", async () => {
    // Régression smoke (28/08/2026) : le journal doit refléter rdv_estimation_realise_le tel qu'il
    // est en base. Ici prévu le 24, tenu le 25 : les deux entrées coexistent avec leur vraie date.
    const prospect = await prospectDeTest("RDV-TENU");
    await qualifierProspectVendeur(prospect.id);
    await planifierRdvEstimationProspectVendeur(prospect.id, new Date("2026-07-24T08:00:00.000Z"));
    await marquerRdvEstimationRealiseProspectVendeur(prospect.id, new Date("2026-07-25T15:30:00.000Z"));
    const html = await rendre(prospect.id);

    expect(html).toContain("Rendez-vous d&#x27;estimation planifié");
    expect(html).toContain("Rendez-vous d&#x27;estimation réalisé");
    expect(html).toContain("24 juillet 2026");
    expect(html).toContain("25 juillet 2026");
  });

  it("ne fabrique jamais une date de réalisation à partir de la date prévue", async () => {
    // Le rendez-vous est planifié dans le futur et n'a pas été marqué réalisé : aucune entrée
    // « réalisé » ne doit exister, et le jalon ne doit pas être franchi.
    const prospect = await prospectDeTest("PREVU-SEUL");
    await qualifierProspectVendeur(prospect.id);
    await planifierRdvEstimationProspectVendeur(prospect.id, new Date(Date.now() + 24 * 60 * 60 * 1000));
    const html = await rendre(prospect.id);

    expect(html).toContain("Rendez-vous d&#x27;estimation planifié");
    expect(html).not.toContain("Rendez-vous d&#x27;estimation réalisé —");
    // Le stade reste Qualification tant que le rendez-vous n'est pas tenu.
    expect(html).toContain("Marquer le rendez-vous d&#x27;estimation réalisé");
  });
});

describe("Fiche prospect vendeur — mandat signé", () => {
  it("clôt le pipeline et ouvre un pont vers le bien réellement créé", async () => {
    const prospect = await prospectDeTest("SIGNE");
    await qualifierProspectVendeur(prospect.id);
    await marquerRdvEstimationRealiseProspectVendeur(prospect.id, new Date("2026-07-24T10:00:00.000Z"));
    await enregistrerEstimationProspectVendeur(prospect.id, 39_500_000, "2026-07-28");

    const resultat = await signerMandatProspectVendeur(prospect.id, {
      reference: `${NOM_PREFIX}-REF-SIGNE`,
      titre: "Maison 118 m²",
      type: "maison",
      adresse: "4 rue Saint-Hélier",
      ville: "Rennes",
      codePostal: "35000",
      surface: 118,
      pieces: 5,
      prix: 412000,
      statutMandat: "actif",
      dateMandat: "2026-08-11",
      caracteristiques: [],
      description: "",
      chargeHonoraires: "vendeur",
    });
    expect(resultat).toBeDefined();
    if (resultat) idsBiens.push(resultat.bien.id);

    const html = await rendre(prospect.id);

    expect(html).toContain("Bien en commercialisation");
    expect(html).toContain("Maison 118 m²");
    expect(html).toContain("4 rue Saint-Hélier");
    expect(html).toContain("Ouvrir la fiche du bien");
    expect(html).toContain(`/biens/${resultat?.bien.id}`);
    expect(html).toContain("Mandat actif");
    // Aucune transition de jalon ne subsiste, et aucune entité mandat n'est inventée.
    expect(html).not.toContain("Prochaine étape");
    expect(html).toContain("Une signature ne peut pas être annulée.");
    expect(html).not.toContain("Numéro de mandat");
    expect(html).not.toContain("Exclusivité");
    expect(html).not.toContain("Durée du mandat");
  });
});

describe("Fiche prospect vendeur — sortie du pipeline", () => {
  it("propose perte et archivage hors du flux, jamais comme des étapes", async () => {
    const prospect = await prospectDeTest("SORTIE");
    const html = await rendre(prospect.id);

    expect(html).toContain("Marquer comme perdu");
    expect(html).toContain("Archiver la fiche");
    // La sortie ne figure jamais dans le rail de progression.
    const positionRail = html.indexOf("Mandat signé");
    const positionSortie = html.indexOf("Marquer comme perdu");
    expect(positionSortie).toBeGreaterThan(positionRail);
  });
});
