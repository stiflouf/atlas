import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PresentationMandatBien } from "@/lib/presentationMandatBien";

// Les Server Actions ne s'exécutent pas dans un rendu statique : remplacées par des fonctions
// inertes, le composant reste purement présentationnel.
vi.mock("@/actions/mandat", () => ({
  ajouterPartieMandatAction: async () => {},
  enregistrerMandatExistantAction: async () => {},
  modifierMandatAction: async () => {},
  modifierRolePartieMandatAction: async () => {},
  resilierMandatAction: async () => {},
  retirerPartieMandatAction: async () => {},
}));

const MandatBienPanel = (await import("./MandatBienPanel")).default;

const BIEN_ID = "00000000-0000-4000-8000-000000000001";
const courant = {
  id: "00000000-0000-4000-8000-0000000000aa",
  bienId: BIEN_ID,
  type: "exclusif" as const,
  numero: "EX-42",
  dateDebut: "2026-01-15",
  dateFin: "2026-12-31",
  exclusiviteJusquAu: undefined,
  creeLe: "2026-01-15T00:00:00.000Z",
};
const ancien = {
  id: "00000000-0000-4000-8000-0000000000bb",
  bienId: BIEN_ID,
  type: undefined,
  dateDebut: "2024-01-01",
  dateFin: "2024-12-31",
  resilieLe: "2024-06-01",
  motifResiliation: "Retrait du bien",
  creeLe: "2024-01-01T00:00:00.000Z",
};
const contactA = { id: "00000000-0000-4000-8000-0000000000c1", nom: "Durand", prenom: "Alice" };
const contactB = { id: "00000000-0000-4000-8000-0000000000c2", nom: "Martin" };
const partie = (id: string, contact: typeof contactA | typeof contactB, role: "mandant" | "representant") => ({
  id,
  mandatId: courant.id,
  contactId: contact.id,
  role,
  creeLe: "2026-01-15T00:00:00.000Z",
  contact,
});

const canonique: PresentationMandatBien = {
  mode: "canonique",
  mandatCourant: courant,
  historique: [
    { ...ancien, statut: "resilie", remplaceParId: courant.id },
    { ...courant, statut: "actif" },
  ],
  parties: [partie("p1", contactA, "mandant"), partie("p2", contactB, "mandant"), partie("p3", { id: "00000000-0000-4000-8000-0000000000c3", nom: "Petit", prenom: "Luc" }, "representant")],
};

function rendre(presentation: PresentationMandatBien, extra: Partial<Parameters<typeof MandatBienPanel>[0]> = {}) {
  return renderToStaticMarkup(<MandatBienPanel bienId={BIEN_ID} presentation={presentation} candidatsContact={[]} {...extra} />);
}

describe("MandatBienPanel — mode canonique", () => {
  it("mandat actuel : statut, type, numéro, dates ; actions Modifier / Résilier ; jamais le vocabulaire technique", () => {
    const html = rendre(canonique);
    expect(html).toContain("Mandat actuel");
    expect(html).toContain("Actif");
    expect(html).toContain("Exclusif");
    expect(html).toContain("EX-42");
    expect(html).toContain("15 janvier 2026");
    expect(html).toContain("31 décembre 2026");
    expect(html).toContain("Modifier le mandat");
    expect(html).toContain("Résilier le mandat");
    expect(html).toContain('name="confirmation"');
    expect(html).not.toContain('name="dateDebut"');
    expect(html).not.toMatch(/canonique|legacy|read model/i);
    expect(html).not.toContain("Enregistrer le mandat existant");
  });

  it("historique : chaque mandat avec statut, type (ou non renseigné), dates, résiliation et remplacement", () => {
    const html = rendre(canonique);
    expect(html).toContain("Historique des mandats");
    expect(html).toContain("Résilié");
    expect(html).toContain("Type non renseigné");
    expect(html).toContain("résilié le 1 juin 2024");
    expect(html).toContain("Retrait du bien");
    expect(html).toContain("remplacé");
    expect(html).toContain("Actuel");
  });

  it("parties : mandants et représentants, lien contact, changement de rôle et retrait confirmé", () => {
    const html = rendre(canonique);
    expect(html).toContain("Alice Durand");
    expect(html).toContain("Martin");
    expect(html).toContain("Luc Petit");
    expect(html).toContain(`href="/contacts/${contactA.id}"`);
    expect(html).toContain("Passer représentant");
    expect(html).toContain("Passer mandant");
    expect(html).toContain("Retirer du mandat");
    expect(html).toContain("Confirmer le retrait de Alice Durand");
    expect(html).toContain("Ajouter une personne au mandat");
    expect(html).not.toContain("undefined");
  });

  it("aucune partie : « Aucun mandant renseigné », rien d'inventé", () => {
    const html = rendre({ ...canonique, parties: [] });
    expect(html).toContain("Aucun mandant renseigné");
    expect(html).toContain("Aucun représentant");
  });

  it("type NULL sur le courant → Non renseigné, jamais Simple", () => {
    const html = rendre({ ...canonique, mandatCourant: { ...courant, type: undefined, numero: undefined, dateFin: undefined }, parties: [] });
    // Le type absent reste absent : « Non renseigné » dans la synthèse, aucune option présélectionnée
    // dans le formulaire de modification (« — Choisir — » sélectionné, jamais « Simple » par défaut).
    expect(html).toContain("Non renseigné");
    expect(html).toContain('<option value="" selected="">— Choisir —</option>');
    expect(html).not.toContain('<option value="simple" selected="">');
  });

  it("canonique sans courant (résilié) : « Aucun mandat en cours », historique visible, aucune action de modification, aucun CTA legacy", () => {
    const html = rendre({ mode: "canonique", mandatCourant: undefined, historique: [{ ...ancien, statut: "resilie" }], parties: [] });
    expect(html).toContain("Aucun mandat en cours");
    expect(html).toContain("Historique des mandats");
    expect(html).toContain("Résilié");
    expect(html).not.toContain("Modifier le mandat");
    expect(html).not.toContain("Enregistrer le mandat existant");
    expect(html).not.toMatch(/>Actif</);
  });

  it("recherche de contact : candidats avec deux boutons explicites ; refus affiché", () => {
    const html = rendre(canonique, { qContact: "dur", candidatsContact: [{ ...contactA, creeLe: "", modifieLe: "" }], refus: "deja_partie" });
    expect(html).toContain("Ajouter comme mandant");
    expect(html).toContain("Ajouter comme représentant");
    expect(html).toContain("déjà partie au mandat");
    expect(rendre(canonique, { qContact: "zzz", candidatsContact: [] })).toContain("Aucun contact ne correspond");
  });
});

describe("MandatBienPanel — legacy et aucun", () => {
  it("legacy-only : statut legacy, date, CTA Enregistrer le mandat existant avec date préremplie et type obligatoire", () => {
    const html = rendre({ mode: "legacy", statutMandat: "suspendu", dateMandat: "2026-03-12" });
    expect(html).toContain("Suspendu");
    expect(html).toContain("12 mars 2026");
    expect(html).toContain("Enregistrer le mandat existant");
    expect(html).toContain('name="dateDebutMandat"');
    expect(html).toContain('value="2026-03-12"');
    expect(html).toContain("Préremplie depuis la date de mandat du bien");
    expect(html).toContain('name="typeMandat" required');
    expect(html).not.toContain("Historique des mandats");
    expect(html).not.toContain("Modifier le mandat");
  });

  it("aucun mandat exploitable : état vide honnête, CTA sans préremplissage", () => {
    const html = rendre({ mode: "aucun" });
    expect(html).toContain("Aucun mandat");
    expect(html).toContain("Non renseigné");
    expect(html).toContain("Enregistrer le mandat existant");
    expect(html).not.toContain("Préremplie");
  });
});
