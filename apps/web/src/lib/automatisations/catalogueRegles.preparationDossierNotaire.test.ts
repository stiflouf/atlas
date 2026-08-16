import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Test d'intégration réel (ADR-046 §43/§45) : couvre la règle `preparation_dossier_notaire_apres_compromis`
// après le reformulation de titre/contexte (ADR-046) — aucun changement de comportement
// fonctionnel (déclencheur, activation, cible, priorité, type, absence d'échéance, idempotence),
// uniquement le wording. Vérifie aussi que "Préparer un email" continue de résoudre exclusivement
// l'acquéreur (jamais un notaire, jamais un vendeur inventé — Atlas ne connaît aucun contact
// notaire structuré) et que "Voir la fiche" reste absent (aucune fiche Compromis, ADR-045/046).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  evenementsMetier,
  executionsAutomatisation,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { traiterExecutionsEnAttente } = await import("./moteur");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");
const { getExecutionAutomatisationById } = await import("./executionAutomatisationRepository");
const { getTacheById } = await import("@/lib/tacheRepository");
const { deriverCibleTache, deriverRouteFicheCible } = await import("@/types/tache");
const { resoudreContexteCommunicationDepuisTache, determinerIntentionParDefaut } = await import(
  "@/lib/communications/resoudreContexteCommunicationDepuisTache"
);

const REGLE = "preparation_dossier_notaire_apres_compromis" as const;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsCompromisCrees: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false);

  const filtreEvt = idsCompromisCrees.length > 0 ? inArray(evenementsMetier.compromisId, idsCompromisCrees) : undefined;
  if (filtreEvt) {
    const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtreEvt);
    const idsEvts = evts.map((e) => e.id);
    if (idsEvts.length > 0) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvts));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvts));
    }
  }
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienEtAcquereurDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] NOTAIRE-${suffixe}`,
    titre: "Bien de test dossier notarial",
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
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Notaire ${suffixe}`,
    email: `test-réel-notaire-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return { bien, acquereur };
}

describe("règle preparation_dossier_notaire_apres_compromis — wording ADR-046, comportement inchangé", () => {
  it("produit une tâche avec le nouveau titre/contexte, cible/priorité/type/échéance inchangés", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("WORDING1");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromis.id);

    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    await traiterExecutionsEnAttente(idsExecutionsATraiter);

    const execution = await getExecutionAutomatisationById(idsExecutionsATraiter[0]);
    expect(execution?.tacheId).toBeDefined();
    const tache = await getTacheById(execution!.tacheId!);
    expect(tache).toBeDefined();

    expect(tache!.titre).toBe("Préparer le dossier notarial");
    expect(tache!.contexte).toBe(
      "Rassembler les éléments nécessaires au suivi du compromis et à la préparation du dossier notarial."
    );
    expect(tache!.type).toBe("document");
    expect(tache!.priorite).toBe("normale");
    expect(tache!.echeance).toBeUndefined();
    expect(tache!.compromisId).toBe(compromis.id);
    expect(tache!.origine).toBe("automatique");
    expect(tache!.origineCode).toBe(REGLE);

    // Jamais l'ancien wording, jamais une mention de destinataire (notaire) laissant croire à un
    // envoi/contact automatique.
    expect(tache!.titre).not.toContain("pour le notaire");
    expect(tache!.contexte).not.toMatch(/notaire/i);

    await definirActivationAutomatisation(REGLE, false);
  });

  it("cible Compromis : Voir la fiche absent (aucune fiche Compromis navigable), Préparer un email présent", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("CIBLE1");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 310000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromis.id);

    const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    await traiterExecutionsEnAttente(idsExecutionsATraiter);
    const execution = await getExecutionAutomatisationById(idsExecutionsATraiter[0]);
    const tache = await getTacheById(execution!.tacheId!);

    const cible = deriverCibleTache(tache!);
    expect(cible).toEqual({ type: "compromis", id: compromis.id });
    expect(deriverRouteFicheCible(tache!)).toBeUndefined();

    const resultat = await resoudreContexteCommunicationDepuisTache(tache!);
    expect(resultat.candidats).toHaveLength(1);
    expect(resultat.candidats[0].type).toBe("acquereur");
    expect(resultat.candidats[0].id).toBe(acquereur.id);
    expect(resultat.candidats.some((c) => c.type !== "acquereur")).toBe(false);

    const intention = determinerIntentionParDefaut(resultat.cibleType, resultat.candidats[0]?.type, resultat.faits);
    expect(intention).toBe("message_compromis");

    await definirActivationAutomatisation(REGLE, false);
  });
});
