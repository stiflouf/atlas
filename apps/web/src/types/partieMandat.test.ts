import { describe, expect, it } from "vitest";
import {
  ROLES_PARTIE_MANDAT,
  estRolePartieMandat,
  prioriteRolePartieMandat,
  roleRetenuPartieMandat,
} from "./partieMandat";

// ADR-060 §16 — vocabulaire fermé et priorité DÉTERMINISTE des rôles de partie de mandat, lue par le
// moteur de fusion Contact : mandant > representant, quel que soit l'ordre des deux Contacts.
describe("RolePartieMandat", () => {
  it("deux rôles, rien d'autre", () => {
    expect([...ROLES_PARTIE_MANDAT]).toEqual(["mandant", "representant"]);
    expect(estRolePartieMandat("mandant")).toBe(true);
    expect(estRolePartieMandat("representant")).toBe(true);
    for (const autre of ["proprietaire", "apporteur", "notaire", "usufruitier", "personne_morale", "", undefined, 1]) {
      expect(estRolePartieMandat(autre), String(autre)).toBe(false);
    }
  });

  it("mandant > representant, symétrique et idempotent", () => {
    expect(prioriteRolePartieMandat("mandant")).toBeLessThan(prioriteRolePartieMandat("representant"));
    expect(roleRetenuPartieMandat("mandant", "representant")).toBe("mandant");
    expect(roleRetenuPartieMandat("representant", "mandant")).toBe("mandant");
    expect(roleRetenuPartieMandat("mandant", "mandant")).toBe("mandant");
    expect(roleRetenuPartieMandat("representant", "representant")).toBe("representant");
  });
});
