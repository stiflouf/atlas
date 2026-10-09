import { beforeEach, describe, expect, it, vi } from "vitest";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — T21 : l'échec d'une politique n'empêche jamais
// les autres d'être évaluées, et n'est jamais présenté comme « 0 éligible ».
//
// Fichier SÉPARÉ de dryRunRetention.test.ts parce que `vi.mock` s'applique à tout un fichier : ici
// le repository entier est remplacé, donc aucun Postgres n'est requis et l'erreur est provoquée à
// l'endroit exact où elle surviendrait en production (la lecture des candidats).

const etat = {
  runsDemarres: [] as { workspaceId: string; mode: string }[],
  runsTermines: [] as { id: string; resultat: Record<string, unknown> }[],
  lectureLeve: false,
};

vi.mock("./retentionRepository", () => ({
  listerCandidatsBonVisitePourRetention: async (workspaceId: string) => {
    if (etat.lectureLeve) throw new Error(`lecture indisponible pour ${workspaceId}`);
    return [];
  },
  demarrerRunRetention: async (workspaceId: string, mode: string) => {
    etat.runsDemarres.push({ workspaceId, mode });
    return `run-${etat.runsDemarres.length}`;
  },
  terminerRunRetention: async (id: string, resultat: Record<string, unknown>) => {
    etat.runsTermines.push({ id, resultat });
  },
}));

vi.mock("@/lib/workspaceRepository", () => ({
  listerTousLesWorkspaceIds: async () => ["ws-a", "ws-b"],
}));

const { executerDryRunRetention } = await import("./dryRunRetention");

beforeEach(() => {
  etat.runsDemarres = [];
  etat.runsTermines = [];
  etat.lectureLeve = false;
});

describe("T21 — isolation des erreurs par politique", () => {
  it("une lecture en échec bloque SA politique et laisse les autres évaluées", async () => {
    etat.lectureLeve = true;
    const resultats = await executerDryRunRetention({ maintenant: new Date("2026-10-09T12:00:00.000Z") });

    expect(resultats).toHaveLength(2);
    for (const workspace of resultats) {
      const enEchec = workspace.politiques.find((p) => p.policyCode === "SIGNED_VISIT_FORM");
      // BLOQUÉE et NOMMÉE : `REPOSITORY_ERROR` plutôt qu'un comptage à zéro, qui serait
      // indistinguable de « rien à faire » — la confusion qui ferait croire un jour qu'une purge
      // n'avait rien à purger.
      expect(enEchec?.status).toBe("BLOCKED_MISSING_TRIGGER");
      expect(enEchec?.blockerCode).toBe("REPOSITORY_ERROR");
      expect(enEchec?.erreurTechnique).toContain("lecture indisponible");
      expect(enEchec?.eligibleCount).toBe(0);

      // Les huit autres politiques sont tout de même rendues avec leur statut propre.
      expect(workspace.politiques).toHaveLength(9);
      expect(workspace.politiques.find((p) => p.policyCode === "SESSION")?.status).toBe("ALREADY_ENFORCED");
      expect(workspace.politiques.find((p) => p.policyCode === "FREE_TEXT_NOTES")?.status).toBe(
        "BLOCKED_UNDECIDED_POLICY"
      );
    }
  });

  it("le run est tout de même terminé, et nomme les politiques en erreur par leur code seul", async () => {
    etat.lectureLeve = true;
    await executerDryRunRetention({ maintenant: new Date("2026-10-09T12:00:00.000Z") });

    expect(etat.runsDemarres.map((r) => r.workspaceId)).toEqual(["ws-a", "ws-b"]);
    expect(etat.runsTermines).toHaveLength(2);
    for (const termine of etat.runsTermines) {
      expect(termine.resultat.erreurTechnique).toBe("politiques_en_erreur: SIGNED_VISIT_FORM");
      // Le journal dit QUELLE politique a échoué, jamais le détail d'une donnée ni un message de
      // driver susceptible de porter une valeur de ligne.
      expect(String(termine.resultat.erreurTechnique)).not.toContain("ws-a");
    }
  });

  it("sans erreur, chaque workspace obtient un run démarré puis terminé, et aucune action", async () => {
    const resultats = await executerDryRunRetention({ maintenant: new Date("2026-10-09T12:00:00.000Z") });
    expect(etat.runsDemarres).toEqual([
      { workspaceId: "ws-a", mode: "dry-run" },
      { workspaceId: "ws-b", mode: "dry-run" },
    ]);
    expect(etat.runsTermines.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    for (const termine of etat.runsTermines) {
      expect(termine.resultat).toMatchObject({ nombrePolitiques: 9, nombreEligibles: 0, nombreBloquees: 5 });
      expect(termine.resultat.erreurTechnique).toBeUndefined();
    }
    expect(resultats.every((r) => r.mode === "dry-run")).toBe(true);
  });

  it("mode apply : aucun run n'est même démarré", async () => {
    await expect(executerDryRunRetention({ mode: "apply" })).rejects.toThrow(/non supporté/);
    expect(etat.runsDemarres).toEqual([]);
    expect(etat.runsTermines).toEqual([]);
  });
});
