import { describe, expect, it } from "vitest";
import { peutEcrireVersExterieur, peutLireDepuisExterieur, type DescripteurConnecteur } from "./contratConnecteur";

// ADR-056 invariant 6 — une capacité est une PROPRIÉTÉ du connecteur, vérifiée avant tout appel.
// Ces tests n'utilisent aucun connecteur réel : un faux connecteur créé pour « utiliser »
// l'interface serait une architecture imaginaire testée contre elle-même. Un descripteur littéral
// suffit, et c'est exactement ce qu'un vrai connecteur déclarera.

const LECTURE_SEULE: DescripteurConnecteur = {
  fournisseur: "fournisseur_de_test",
  capacites: { contact: "read_only", interaction: "pull" },
};

const BIDIRECTIONNEL: DescripteurConnecteur = {
  fournisseur: "fournisseur_de_test",
  capacites: { contact: "bidirectionnel", bien: "push", projet_acquereur: "pull" },
};

describe("capacités de synchronisation", () => {
  it("un connecteur sans push ne peut structurellement jamais écrire vers l'extérieur", () => {
    expect(peutEcrireVersExterieur(LECTURE_SEULE, "contact")).toBe(false);
    expect(peutEcrireVersExterieur(LECTURE_SEULE, "interaction")).toBe(false);
  });

  it("push et bidirectionnel autorisent l'écriture, et eux seuls", () => {
    expect(peutEcrireVersExterieur(BIDIRECTIONNEL, "contact")).toBe(true);
    expect(peutEcrireVersExterieur(BIDIRECTIONNEL, "bien")).toBe(true);
    expect(peutEcrireVersExterieur(BIDIRECTIONNEL, "projet_acquereur")).toBe(false);
  });

  it("l'omission vaut REFUS, jamais permission par défaut", () => {
    // Le point le plus important : un type d'entité qu'un connecteur n'a pas déclaré n'est ni
    // lisible ni écrivable. Un défaut permissif ferait qu'oublier une ligne ouvrirait un accès.
    expect(peutEcrireVersExterieur(LECTURE_SEULE, "mandat")).toBe(false);
    expect(peutLireDepuisExterieur(LECTURE_SEULE, "mandat")).toBe(false);
    expect(peutLireDepuisExterieur(BIDIRECTIONNEL, "projet_vendeur")).toBe(false);
  });

  it("une capacité déclarée, même en lecture seule, autorise la lecture", () => {
    expect(peutLireDepuisExterieur(LECTURE_SEULE, "contact")).toBe(true);
    expect(peutLireDepuisExterieur(LECTURE_SEULE, "interaction")).toBe(true);
  });
});
