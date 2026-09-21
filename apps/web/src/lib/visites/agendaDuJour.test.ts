import { describe, expect, it } from "vitest";
import { fusionnerAgendaDuJour } from "./agendaDuJour";
import type { VisiteDuJour } from "@/lib/visiteRepository";
import type { RendezVous } from "@/types/agenda";

// VISIT_NATIVE_ENTRY_V1 (brief §14-§18) — fusion pure Calendar × Visites DOMIORA du jour.

function rdv(id: string): RendezVous {
  return { id, heure: "10:00", type: "visite", titre: `RDV ${id}`, preparationDisponible: false, date: "2026-09-21" };
}

function visite(id: string, statut: VisiteDuJour["statut"], rendezVousCalendarId?: string): VisiteDuJour {
  return {
    id,
    bienId: "bien",
    acquereurId: "acq",
    datePrevue: "2026-09-21",
    statut,
    rendezVousCalendarId,
    creeLe: "2026-09-01T00:00:00.000Z",
    bien: { id: "bien", titre: "Bien", adresse: "1 rue", codePostal: "00000", ville: "Ville" },
    acquereur: { id: "acq", nom: "Acquéreur" },
  };
}

describe("fusionnerAgendaDuJour", () => {
  it("Visite Calendar-backed planifiée + événement Calendar correspondant → un seul item, la Visite canonique", () => {
    const { visites, rendezVous } = fusionnerAgendaDuJour([rdv("gcal-1")], [visite("v1", "planifiee", "gcal-1")]);
    expect(visites.map((v) => v.id)).toEqual(["v1"]);
    expect(rendezVous).toEqual([]);
  });

  it("Visite Calendar-backed annulée + événement Calendar → aucun item actif", () => {
    const { visites, rendezVous } = fusionnerAgendaDuJour([rdv("gcal-1")], [visite("v1", "annulee", "gcal-1")]);
    expect(visites).toEqual([]);
    expect(rendezVous).toEqual([]);
  });

  it("Visite Calendar-backed réalisée + événement Calendar → aucun item futur", () => {
    const { visites, rendezVous } = fusionnerAgendaDuJour([rdv("gcal-1")], [visite("v1", "realisee", "gcal-1")]);
    expect(visites).toEqual([]);
    expect(rendezVous).toEqual([]);
  });

  it("Visite native planifiée (sans Calendar) → un item", () => {
    const { visites, rendezVous } = fusionnerAgendaDuJour([], [visite("v1", "planifiee")]);
    expect(visites.map((v) => v.id)).toEqual(["v1"]);
    expect(rendezVous).toEqual([]);
  });

  it("événement Calendar sans Visite → un item Calendar, inchangé", () => {
    const { visites, rendezVous } = fusionnerAgendaDuJour([rdv("gcal-2")], []);
    expect(visites).toEqual([]);
    expect(rendezVous.map((r) => r.id)).toEqual(["gcal-2"]);
  });

  it("cas mixte : native + Calendar-backed + événement seul → 3 rendez-vous logiques, jamais 4", () => {
    const { visites, rendezVous } = fusionnerAgendaDuJour(
      [rdv("gcal-1"), rdv("gcal-2")],
      [visite("native", "planifiee"), visite("materialisee", "planifiee", "gcal-1")]
    );
    expect(visites.map((v) => v.id)).toEqual(["native", "materialisee"]);
    expect(rendezVous.map((r) => r.id)).toEqual(["gcal-2"]);
    expect(visites.length + rendezVous.length).toBe(3);
  });

  it("Visite native annulée ou réalisée → jamais affichée", () => {
    const { visites } = fusionnerAgendaDuJour([], [visite("a", "annulee"), visite("r", "realisee")]);
    expect(visites).toEqual([]);
  });
});
