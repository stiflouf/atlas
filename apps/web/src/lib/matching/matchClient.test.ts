import { describe, expect, it } from "vitest";
import { matcherClient } from "./matchClient";
import { contientMot } from "./normaliser";
import type { ProfilAcquereur } from "@/types/client";
import type { RendezVous } from "@/types/agenda";

// ADR-057 — `lib/matching` n'avait aucun test. Celui-ci couvre la seule chose que la nullabilité du
// prénom change ici : un acquéreur connu par son seul nom (ADR-055 §A) doit rester rapprochable
// sans faire échouer le rapprochement des autres.

const RDV: RendezVous = {
  id: "rdv-1",
  heure: "10:00",
  type: "visite",
  titre: "Visite avec Jeanne Dupont",
  preparationDisponible: false,
};

function unClient(surcharge: Partial<ProfilAcquereur>): ProfilAcquereur {
  return {
    id: "client-1",
    nom: "Dupont",
    prenom: "Jeanne",
    email: "jeanne@example.test",
    telephone: "0600000000",
    budgetMin: 100_000,
    budgetMax: 400_000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  };
}

describe("matcherClient — prénom absent (ADR-057)", () => {
  it("un mot vide ne peut JAMAIS correspondre à un texte quelconque", () => {
    // Garantie portée par `contientMot` lui-même, indépendamment du prénom : c'est elle qui exclut
    // toute correspondance universelle, et elle est vérifiée ici pour qu'un futur remaniement de
    // `normaliser.ts` ne puisse pas la retirer en silence.
    expect(contientMot("visite avec jeanne dupont", "")).toBe(false);
    expect(contientMot("n importe quel texte", "")).toBe(false);
  });

  it("un acquéreur sans prénom ne fait pas échouer le rapprochement", () => {
    // Sans la garde, `normaliser(undefined)` lève et emporte TOUT le rapprochement du rendez-vous,
    // y compris celui des autres acquéreurs.
    const sansPrenom = unClient({ id: "sans-prenom", prenom: undefined, nom: "Martin" });
    const avecPrenom = unClient({ id: "avec-prenom" });

    const candidats = matcherClient(RDV, [sansPrenom, avecPrenom]);

    expect(candidats.map((c) => c.clientId)).toEqual(["avec-prenom"]);
    expect(candidats[0]!.matchedBy).toBe("nom_complet_client");
  });

  it("un acquéreur sans prénom reste rapprochable par son nom", () => {
    const sansPrenom = unClient({ id: "sans-prenom", prenom: undefined, nom: "Dupont" });

    const candidats = matcherClient(RDV, [sansPrenom]);

    expect(candidats).toHaveLength(1);
    expect(candidats[0]!.matchedBy).toBe("nom_client");
  });

  it("un acquéreur sans prénom ne matche pas un rendez-vous qui ne le nomme pas", () => {
    const sansPrenom = unClient({ id: "sans-prenom", prenom: undefined, nom: "Lefevre" });

    expect(matcherClient(RDV, [sansPrenom])).toEqual([]);
  });
});
