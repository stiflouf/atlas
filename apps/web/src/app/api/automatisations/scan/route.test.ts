import { describe, expect, it, vi } from "vitest";

// Le secret est fixé AVANT l'import de la route — la route lit process.env au moment de l'appel,
// pas à l'import, mais fixer tôt évite toute ambiguïté d'ordre.
process.env.AUTOMATISATIONS_SCAN_SECRET = "secret-de-test-tres-long-et-suffisant";

// Sujet de cette suite : le contrat HTTP de l'endpoint (garde du secret partagé, passe-plat du
// résultat du REGISTRE) — jamais un scanner individuel, chacun couvert en base réelle par sa propre
// suite (scanTemporel.test.ts et scanners/*.test.ts). `executerScanTemporelComplet` (le point
// d'entrée du registre, AUTOMATION_ENGINE_GENERALIZATION_V1) est donc remplacé ici. Sans ce
// remplacement, l'appel 200 toucherait les lignes de configuration PARTAGÉES de toutes les règles
// temporelles : identités métier CANONIQUES (clé primaire + CHECK sur regle_code, impossible d'en
// dériver une variante unique par fichier de test) dont chaque suite de scanner est la seule
// propriétaire légitime. Ce fichier ne touche donc plus du tout la base — aucune DATABASE_URL n'est
// nécessaire ici.
const scannerMock = vi.fn();
vi.mock("@/lib/automatisations/scanTemporel", () => ({
  executerScanTemporelComplet: scannerMock,
}));

const { POST } = await import("./route");

function requete(autorisation?: string): Request {
  const headers = new Headers();
  if (autorisation !== undefined) headers.set("authorization", autorisation);
  return new Request("http://localhost/api/automatisations/scan", { method: "POST", headers });
}

describe("POST /api/automatisations/scan", () => {
  it("401 si l'en-tête Authorization est absent", async () => {
    const reponse = await POST(requete());
    expect(reponse.status).toBe(401);
    expect(scannerMock).not.toHaveBeenCalled();
  });

  it("401 si le secret est incorrect", async () => {
    const reponse = await POST(requete("Bearer mauvais-secret"));
    expect(reponse.status).toBe(401);
    expect(scannerMock).not.toHaveBeenCalled();
  });

  it("401 si le schéma n'est pas Bearer", async () => {
    const reponse = await POST(requete("Basic secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(401);
    expect(scannerMock).not.toHaveBeenCalled();
  });

  it("200 avec le secret correct : renvoie tel quel le résultat du registre (un tableau, un par scanner)", async () => {
    scannerMock.mockResolvedValueOnce([
      { codeRegle: "inactivite_prospect_vendeur", execute: false },
      { codeRegle: "mandat_expire_bientot", execute: false },
      { codeRegle: "offre_sans_decision", execute: false },
      { codeRegle: "offre_acceptee_sans_compromis", execute: false },
    ]);
    const reponse = await POST(requete("Bearer secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual([
      { codeRegle: "inactivite_prospect_vendeur", execute: false },
      { codeRegle: "mandat_expire_bientot", execute: false },
      { codeRegle: "offre_sans_decision", execute: false },
      { codeRegle: "offre_acceptee_sans_compromis", execute: false },
    ]);
    expect(scannerMock).toHaveBeenCalledTimes(1);
  });
});
