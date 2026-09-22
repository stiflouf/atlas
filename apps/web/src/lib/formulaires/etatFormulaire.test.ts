import { describe, expect, it } from "vitest";
import { ETAT_FORMULAIRE_INITIAL, ErreurSaisie, avecFeedbackFormulaire } from "./etatFormulaire";

// FORM_FEEDBACK_V1 — le helper est FAIL-CLOSED : seule une ErreurSaisie devient un état de
// formulaire ; tout le reste (redirect Next, session, DB, bug) est relancé tel quel.
describe("avecFeedbackFormulaire", () => {
  it("A. ErreurSaisie → état erreur avec le message, sans exception", async () => {
    await expect(avecFeedbackFormulaire(async () => { throw new ErreurSaisie("Titre requis."); })).resolves.toEqual({
      statut: "erreur",
      message: "Titre requis.",
    });
  });

  it("succès sans redirection → état initial", async () => {
    await expect(avecFeedbackFormulaire(async () => {})).resolves.toEqual(ETAT_FORMULAIRE_INITIAL);
  });

  it("B. Error standard (bug / invariant) → relancée telle quelle", async () => {
    const erreur = new Error("Contact canonique introuvable pour ce prospect vendeur.");
    await expect(avecFeedbackFormulaire(async () => { throw erreur; })).rejects.toBe(erreur);
  });

  it("C. erreur DB simulée (objet d'erreur Postgres) → relancée telle quelle", async () => {
    class PostgresError extends Error { code = "23503"; }
    const erreur = new PostgresError('update or delete on table "biens" violates foreign key constraint');
    await expect(avecFeedbackFormulaire(async () => { throw erreur; })).rejects.toBe(erreur);
  });

  it("D. NEXT_REDIRECT (redirect() de Next) → préservé, jamais transformé en état", async () => {
    const redirection = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/visites/abc;307;" });
    await expect(avecFeedbackFormulaire(async () => { throw redirection; })).rejects.toBe(redirection);
  });

  it("E. erreur de session / workspace → relancée (fail-closed)", async () => {
    const session = new Error("Non authentifié.");
    await expect(avecFeedbackFormulaire(async () => { throw session; })).rejects.toBe(session);
    const workspace = new Error("Plusieurs appartenances trouvées pour cette identité : aucun mécanisme de sélection de workspace n'existe (voir ADR-054).");
    await expect(avecFeedbackFormulaire(async () => { throw workspace; })).rejects.toBe(workspace);
  });

  it("une sous-classe étrangère nommée comme une ErreurSaisie n'est pas capturée (instanceof strict)", async () => {
    class Imposteur extends Error { name = "ErreurSaisie"; }
    const erreur = new Imposteur("faux");
    await expect(avecFeedbackFormulaire(async () => { throw erreur; })).rejects.toBe(erreur);
  });
});
