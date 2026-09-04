import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectionnerReperesPourCommunication } from "./politiqueReperesCommunication";
import type { DestinataireCandidat } from "@/lib/communications/contexteCommunication";
import type { CategorieRepereRelationnel, RepereRelationnel } from "@/types/repereRelationnel";

// VALUE-07B (ADR-053) — la politique est une fonction PURE : ces tests ne touchent aucune base,
// aucun composant, aucun fournisseur. C'est précisément ce qui la rend vérifiable ligne à ligne,
// et c'est la raison pour laquelle elle ne vit ni dans l'UI ni dans le prompt.

const ACQUEREUR_ID = "550e8400-e29b-41d4-a716-446655440000";
const AUTRE_ACQUEREUR_ID = "550e8400-e29b-41d4-a716-446655440001";

const ACQUEREUR: DestinataireCandidat = {
  type: "acquereur",
  id: ACQUEREUR_ID,
  nom: "Ferrand",
  prenom: "Camille",
  email: "camille.ferrand@example.com",
};
const VENDEUR: DestinataireCandidat = { type: "prospectVendeur", id: "vendeur-1", nom: "Martin" };

function repere(champs: Partial<RepereRelationnel> = {}): RepereRelationnel {
  return {
    id: `repere-${champs.libelle ?? "1"}`,
    acquereurId: ACQUEREUR_ID,
    categorie: "preference_contact",
    libelle: "Préfère les échanges par email",
    provenance: "indique_par_le_client",
    utilisableCommunication: true,
    creeLe: "2026-09-01T10:00:00.000Z",
    ...champs,
  };
}

describe("politiqueReperesCommunication — éligibilité", () => {
  it("un repère actif et autorisé de cet acquéreur est affichable", () => {
    const { reperesAffichables } = selectionnerReperesPourCommunication(ACQUEREUR, [repere()]);

    expect(reperesAffichables).toHaveLength(1);
  });

  it("un repère actif mais non autorisé n'est jamais affiché", () => {
    const { reperesAffichables } = selectionnerReperesPourCommunication(ACQUEREUR, [
      repere({ utilisableCommunication: false }),
    ]);

    expect(reperesAffichables).toEqual([]);
  });

  it("un repère archivé n'est jamais affiché, même autorisé", () => {
    // Patron ADR-012 : l'archivage sort le repère de la mémoire active, quelle que soit la case.
    const { reperesAffichables } = selectionnerReperesPourCommunication(ACQUEREUR, [
      repere({ archiveLe: "2026-09-02T10:00:00.000Z" }),
    ]);

    expect(reperesAffichables).toEqual([]);
  });

  it("un repère appartenant à un autre acquéreur n'est jamais affiché", () => {
    const { reperesAffichables } = selectionnerReperesPourCommunication(ACQUEREUR, [
      repere({ acquereurId: AUTRE_ACQUEREUR_ID }),
    ]);

    expect(reperesAffichables).toEqual([]);
  });

  it("un destinataire vendeur n'obtient aucun repère", () => {
    // relance_prospect_vendeur, suivi_rdv_estimation, retour_vendeur_apres_visite : les repères
    // appartiennent à un acquéreur, ces intentions n'en portent aucun par construction.
    const resultat = selectionnerReperesPourCommunication(VENDEUR, [repere({ acquereurId: "vendeur-1" })]);

    expect(resultat).toEqual({ reperesAffichables: [], presencePreferenceContact: false });
  });

  it("aucun destinataire résolu — message notaire, ou choix pas encore fait — n'obtient aucun repère", () => {
    const resultat = selectionnerReperesPourCommunication(undefined, [repere()]);

    expect(resultat).toEqual({ reperesAffichables: [], presencePreferenceContact: false });
  });

  it("plusieurs catégories autorisées sont toutes affichées, dans l'ordre reçu", () => {
    const categories: CategorieRepereRelationnel[] = [
      "preference_contact",
      "preference_relationnelle",
      "centre_interet",
      "autre",
    ];
    const { reperesAffichables } = selectionnerReperesPourCommunication(
      ACQUEREUR,
      categories.map((categorie) => repere({ categorie, libelle: categorie }))
    );

    // L'ordre déterministe du repository (ancienneté puis id) est conservé tel quel : la politique
    // ne retrie rien et n'introduit aucune hiérarchie entre catégories.
    expect(reperesAffichables.map((r) => r.categorie)).toEqual(categories);
  });
});

describe("politiqueReperesCommunication — le libellé n'est jamais interprété", () => {
  // Trois libellés qui « disent » des choses opposées, tous les autres champs structurés
  // identiques. Une politique qui lirait le texte produirait trois résultats différents.
  const LIBELLES = ["Préfère les échanges par email", "Appelez-moi plutôt", "ZXQ_CHAINE_SANS_SEMANTIQUE"];

  it("les trois libellés produisent exactement le même signal structurel", () => {
    const signaux = LIBELLES.map(
      (libelle) =>
        selectionnerReperesPourCommunication(ACQUEREUR, [repere({ categorie: "preference_contact", libelle })])
          .presencePreferenceContact
    );

    expect(signaux).toEqual([true, true, true]);
  });

  it("la sortie ne porte aucun canal déduit", () => {
    const resultat = selectionnerReperesPourCommunication(ACQUEREUR, [repere()]);

    // DOMIORA sait qu'une préférence de contact EXISTE. Il ne prétend pas savoir laquelle, ni si
    // le canal courant la contredit — le dire supposerait de lire le texte libre (ADR-008).
    expect(Object.keys(resultat).sort()).toEqual(["presencePreferenceContact", "reperesAffichables"]);
    const rendu = JSON.stringify(resultat);
    for (const champInterdit of ["emailPrefere", "telephonePrefere", "smsPrefere", "canalCompatible", "conflitCanal"]) {
      expect(rendu).not.toContain(champInterdit);
    }
  });

  it("une catégorie autre que preference_contact ne lève jamais le signal, quel que soit le texte", () => {
    const { presencePreferenceContact } = selectionnerReperesPourCommunication(ACQUEREUR, [
      repere({ categorie: "autre", libelle: "Préfère les échanges par email" }),
    ]);

    expect(presencePreferenceContact).toBe(false);
  });

  it("le code de la politique ne lit jamais le libellé", () => {
    // Garde de source : empêche qu'une future « petite règle pratique » réintroduise du parsing
    // par mots-clés, exactement ce qu'ADR-008 et ADR-053 ferment. Les commentaires sont retirés :
    // ils PARLENT du libellé, c'est le code qui ne doit pas le lire.
    const source = readFileSync(join(__dirname, "politiqueReperesCommunication.ts"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    expect(source).not.toContain(".libelle");
    for (const motifInterdit of ["includes(", "startsWith(", "toLowerCase(", ".match(", "RegExp"]) {
      expect(source).not.toContain(motifInterdit);
    }
  });
});
