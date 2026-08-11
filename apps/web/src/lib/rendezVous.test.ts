import { describe, expect, it } from "vitest";
import type { RendezVous } from "@/types/agenda";
import { rendezVousAVenir } from "./rendezVous";

function rdvTest(surcharge: Partial<RendezVous> = {}): RendezVous {
  return {
    id: "rdv-test",
    heure: "10h00",
    type: "visite",
    titre: "Rendez-vous de test",
    preparationDisponible: false,
    ...surcharge,
  };
}

describe("rendezVousAVenir", () => {
  const aujourdHuiISO = "2026-08-11";

  it("exclut les rendez-vous d'aujourd'hui", () => {
    const rdv = rdvTest({ id: "rdv-jour", date: aujourdHuiISO });
    expect(rendezVousAVenir([rdv], aujourdHuiISO)).toEqual([]);
  });

  it("exclut les rendez-vous mockés sans date", () => {
    const rdv = rdvTest({ id: "rdv-sans-date" });
    expect(rendezVousAVenir([rdv], aujourdHuiISO)).toEqual([]);
  });

  it("inclut un rendez-vous demain", () => {
    const rdv = rdvTest({ id: "rdv-demain", date: "2026-08-12" });
    expect(rendezVousAVenir([rdv], aujourdHuiISO)).toEqual([rdv]);
  });

  it("trie par date croissante, puis journée entière d'abord, puis heure croissante", () => {
    const tard = rdvTest({ id: "j13-tard", date: "2026-08-13", heure: "18h00" });
    const tot = rdvTest({ id: "j13-tot", date: "2026-08-13", heure: "09h00" });
    const journeeEntiereJ13 = rdvTest({ id: "j13-journee", date: "2026-08-13", journeeEntiere: true, heure: "00h00" });
    const demain = rdvTest({ id: "j12", date: "2026-08-12", heure: "09h00" });

    const resultat = rendezVousAVenir([tard, tot, journeeEntiereJ13, demain], aujourdHuiISO);

    expect(resultat.map((rdv) => rdv.id)).toEqual(["j12", "j13-journee", "j13-tot", "j13-tard"]);
  });
});
