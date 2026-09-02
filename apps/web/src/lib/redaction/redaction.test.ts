import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  projeterFaitsAutorises,
  type ContexteRedactionAugmentee,
  type RedacteurCommunication,
  type ResultatRedaction,
} from "./contrat";
import { validerReformulation } from "./gardeFous";
import { reformulerBrouillon } from "./orchestration";
import { PROMPT_SYSTEME, construirePromptUtilisateur } from "./prompt";
import { redactionAssisteeDisponible, resoudreRedacteur } from "./redacteur";
import type { FaitsCommunication } from "@/lib/communications/contexteCommunication";

// Marqueurs sentinelles : aucune de ces chaînes ne doit pouvoir atteindre le rédacteur. Elles sont
// volontairement absurdes pour qu'une correspondance accidentelle soit impossible.
const SECRET_NOTE_ACQUEREUR = "SECRETNOTEACQUEREUR";
const SECRET_TACHE_INTERNE = "SECRETTACHEINTERNE";
const SECRET_RETOUR_VISITE = "SECRETRETOURVISITE";
const SECRET_MATCHING_EXPLICATION = "SECRETMATCHINGEXPLICATION";

const OBJET_SOURCE = "Suite à votre visite — 14 rue des Tilleuls Fictifs";
const CORPS_SOURCE = [
  "Bonjour Camille,",
  "",
  "Suite à votre visite du 31 août 2026 (14 rue des Tilleuls Fictifs), je souhaitais avoir votre retour.",
  "Nous avions noté à l'issue de la visite : Intéressé.",
  "",
  "Cordialement,",
].join("\n");

function contexte(surcharge: Partial<ContexteRedactionAugmentee> = {}): ContexteRedactionAugmentee {
  return {
    ton: "professionnel",
    objetActuel: OBJET_SOURCE,
    corpsActuel: CORPS_SOURCE,
    faitsAutorises: {
      destinatairePrenom: "Camille",
      bienAdresse: "14 rue des Tilleuls Fictifs",
      dateVisite: "31 août 2026",
      interetVisite: "Intéressé",
    },
    ...surcharge,
  };
}

// Rédacteur factice : aucun test ne joint jamais un fournisseur réel, aucune consommation, aucune
// dépendance réseau.
function redacteurFactice(
  reponse: ResultatRedaction | (() => never),
  espion?: (c: ContexteRedactionAugmentee) => void
): RedacteurCommunication {
  return {
    nom: "factice",
    async reformuler(c) {
      espion?.(c);
      if (typeof reponse === "function") return reponse();
      return reponse;
    },
  };
}

const REFORMULATION_VALIDE = {
  type: "reformule" as const,
  objet: "Suite à votre visite du 14 rue des Tilleuls Fictifs",
  corps: [
    "Bonjour Camille,",
    "",
    "Je reviens vers vous après votre visite du 31 août 2026, au 14 rue des Tilleuls Fictifs.",
    "Votre retour était : Intéressé. Souhaitez-vous que nous échangions sur la suite ?",
    "",
    "Cordialement,",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Projection : ce qui atteint le modèle
// ---------------------------------------------------------------------------

describe("projection des faits autorisés", () => {
  // Tous les champs de FaitsCommunication, y compris ceux strictement internes.
  const FAITS_COMPLETS: FaitsCommunication = {
    destinataireNom: "Ferrand",
    destinatairePrenom: "Camille",
    bienAdresse: "14 rue des Tilleuls Fictifs",
    dateVisite: "31 août 2026",
    interetVisite: "Intéressé",
    interetVisiteValeur: "interesse",
    dateRdvEstimation: "16 août 2026",
    montantOffre: 730_000,
    dateOffre: "27 août 2026",
    prixConvenuCompromis: 730_000,
    dateActeCompromis: "16 novembre 2026",
    documentLabel: "Pré-état daté",
    documentsAObtenirNotaire: ["Diagnostic électricité"],
    criteresCompatibles: ["votre budget"],
    mandatPropose: true,
    tacheContexte: `${SECRET_TACHE_INTERNE} — client difficile, financement douteux`,
  };

  it("ne retient que la liste blanche, jamais un champ interne", () => {
    expect(projeterFaitsAutorises(FAITS_COMPLETS)).toEqual({
      destinatairePrenom: "Camille",
      bienAdresse: "14 rue des Tilleuls Fictifs",
      dateVisite: "31 août 2026",
      interetVisite: "Intéressé",
      criteresCompatibles: ["votre budget"],
    });
  });

  it("le contexte interne d'une tâche n'atteint jamais le prompt", () => {
    const projection = projeterFaitsAutorises(FAITS_COMPLETS);
    const prompt = construirePromptUtilisateur(contexte({ faitsAutorises: projection }));
    expect(prompt).not.toContain(SECRET_TACHE_INTERNE);
    expect(prompt).not.toContain("financement douteux");
  });

  it("aucun montant ni jalon transactionnel ne franchit la projection", () => {
    const serialise = JSON.stringify(projeterFaitsAutorises(FAITS_COMPLETS));
    for (const interdit of ["730000", "Pré-état daté", "Diagnostic électricité", "16 novembre", "mandatPropose"]) {
      expect(serialise).not.toContain(interdit);
    }
  });

  it("un rédacteur ne reçoit jamais autre chose que le contexte projeté", async () => {
    let recu: ContexteRedactionAugmentee | undefined;
    await reformulerBrouillon(
      redacteurFactice(REFORMULATION_VALIDE, (c) => {
        recu = c;
      }),
      contexte({ faitsAutorises: projeterFaitsAutorises(FAITS_COMPLETS) })
    );
    const serialise = JSON.stringify(recu);
    for (const sentinelle of [
      SECRET_NOTE_ACQUEREUR,
      SECRET_TACHE_INTERNE,
      SECRET_RETOUR_VISITE,
      SECRET_MATCHING_EXPLICATION,
    ]) {
      expect(serialise).not.toContain(sentinelle);
    }
    expect(Object.keys(recu!)).toEqual(["ton", "objetActuel", "corpsActuel", "faitsAutorises"]);
  });

  it("une note acquéreur, un retour de visite et une explication de matching restent hors du prompt", () => {
    // Ces trois données n'ont aucun champ d'accueil dans FaitsAutorisesRedaction : elles ne peuvent
    // pas être transmises, même par erreur d'appel.
    const prompt = `${PROMPT_SYSTEME}\n${construirePromptUtilisateur(contexte())}`;
    for (const sentinelle of [SECRET_NOTE_ACQUEREUR, SECRET_RETOUR_VISITE, SECRET_MATCHING_EXPLICATION]) {
      expect(prompt).not.toContain(sentinelle);
    }
  });
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

describe("prompt", () => {
  it("énonce la mission étroite et les interdits", () => {
    expect(PROMPT_SYSTEME).toContain("Tu ne fais que reformuler");
    expect(PROMPT_SYSTEME).toContain("EXHAUSTIVE");
    expect(PROMPT_SYSTEME).toContain("N'invente jamais");
    expect(PROMPT_SYSTEME).toContain("notes internes du conseiller ne te sont pas fournies");
    expect(PROMPT_SYSTEME).toContain("aucun conseil juridique");
    expect(PROMPT_SYSTEME).toContain('{"objet": "...", "corps": "..."}');
  });

  it("transmet le ton canonique DOMIORA, jamais une seconde taxonomie", () => {
    expect(construirePromptUtilisateur(contexte({ ton: "relance_douce" }))).toContain(
      "Ton demandé : Relance douce — sans aucune pression ni reproche"
    );
    expect(construirePromptUtilisateur(contexte({ ton: "court" }))).toContain("réellement court");
    expect(construirePromptUtilisateur(contexte({ ton: "cordial" }))).toContain("sans familiarité excessive");
    expect(construirePromptUtilisateur(contexte({ ton: "professionnel" }))).toContain("précis, naturel et sobre");
  });

  it("un fait absent n'est jamais remplacé par un espace réservé", () => {
    const prompt = construirePromptUtilisateur(
      contexte({ faitsAutorises: { destinatairePrenom: "Camille" } })
    );
    expect(prompt).toContain("- prénom du destinataire : Camille");
    expect(prompt).not.toContain("adresse du bien");
    expect(prompt).not.toContain("undefined");
  });

  it("stable à entrées identiques", () => {
    expect(construirePromptUtilisateur(contexte())).toBe(construirePromptUtilisateur(contexte()));
  });
});

// ---------------------------------------------------------------------------
// Garde-fous
// ---------------------------------------------------------------------------

describe("garde-fous", () => {
  const valider = (objet: string, corps: string, c = contexte()) => validerReformulation(c, objet, corps);
  const motif = (objet: string, corps: string, c = contexte()) => {
    const r = valider(objet, corps, c);
    return r.valide ? undefined : r.motif;
  };

  it("accepte une reformulation fidèle", () => {
    expect(valider(REFORMULATION_VALIDE.objet, REFORMULATION_VALIDE.corps)).toEqual({ valide: true });
  });

  it("rejette un objet ou un corps vide", () => {
    expect(motif("", CORPS_SOURCE)).toBe("objet_vide");
    expect(motif("   ", CORPS_SOURCE)).toBe("objet_vide");
    expect(motif(OBJET_SOURCE, "")).toBe("corps_vide");
  });

  it("rejette une sortie trop longue", () => {
    expect(motif("o".repeat(200), CORPS_SOURCE)).toBe("objet_trop_long");
    expect(motif(OBJET_SOURCE, "c".repeat(4000))).toBe("corps_trop_long");
  });

  it("rejette tout balisage", () => {
    expect(motif(OBJET_SOURCE, "```json\n{}\n```")).toBe("markdown");
    expect(motif(OBJET_SOURCE, "## Titre\nBonjour")).toBe("markdown");
    expect(motif(OBJET_SOURCE, "<p>Bonjour</p>")).toBe("markdown");
  });

  it("rejette une URL absente de la source", () => {
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nVoir https://exemple-inconnu.test/bien`)).toBe("url_inattendue");
  });

  it("rejette une chaîne à l'allure de secret", () => {
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nsk-abcdefghijklmnop`)).toBe("secret_apparent");
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nAuthorization: Bearer xyz`)).toBe("secret_apparent");
  });

  it("rejette un pourcentage inventé", () => {
    expect(motif(OBJET_SOURCE, CORPS_SOURCE.replace("Intéressé", "compatible à 95%"))).toBe("pourcentage_invente");
  });

  it("rejette un nombre ou un prix absent de la source et des faits", () => {
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nLe prix est de 389 000 €.`)).toBe("nombre_inconnu");
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nNous avons visité 3 biens.`)).toBe("nombre_inconnu");
  });

  it("tolère un changement de séparateur de milliers, qui ne change aucun fait", () => {
    const c = contexte({ corpsActuel: "Bonjour,\n\nLe prix convenu est de 730 000 €.\n\nCordialement," });
    expect(valider("Objet", "Bonjour,\n\nLe prix convenu s'élève à 730000 €.\n\nCordialement,", c)).toEqual({
      valide: true,
    });
  });

  it("rejette une date inventée", () => {
    expect(motif(OBJET_SOURCE, CORPS_SOURCE.replace("31 août 2026", "15 septembre 2026"))).toBe("nombre_inconnu");
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nJe vous rappelle en septembre.`)).toBe("date_inconnue");
  });

  it("rejette une personne, une ville ou une adresse inconnues", () => {
    expect(motif(OBJET_SOURCE, CORPS_SOURCE.replace("Camille", "Sophie"))).toBe("entite_inconnue");
    expect(motif(OBJET_SOURCE, `${CORPS_SOURCE}\nÀ bientôt sur Bordeaux.`)).toBe("entite_inconnue");
  });

  it("ne confond jamais une capitale de début de phrase avec un nom propre", () => {
    const corps = [
      "Bonjour Camille,",
      "",
      "Souhaitez-vous que nous échangions ? Auriez-vous un moment cette semaine ?",
      "Merci de votre retour. Bien à vous,",
      "",
      "Cordialement,",
    ].join("\n");
    expect(valider("Suite à votre visite", corps)).toEqual({ valide: true });
  });

  it("un prénom fourni uniquement dans les faits autorisés reste accepté", () => {
    const c = contexte({
      objetActuel: "Suite à notre échange",
      corpsActuel: "Bonjour,\n\nJe reviens vers vous.\n\nCordialement,",
      faitsAutorises: { destinatairePrenom: "Camille" },
    });
    expect(valider("Suite à notre échange", "Bonjour Camille,\n\nJe reviens vers vous.\n\nCordialement,", c)).toEqual({
      valide: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Orchestration et repli
// ---------------------------------------------------------------------------

describe("orchestration", () => {
  it("sortie valide : objet et corps reformulés sont rendus", async () => {
    const r = await reformulerBrouillon(redacteurFactice(REFORMULATION_VALIDE), contexte());
    expect(r).toEqual(REFORMULATION_VALIDE);
  });

  it("rédacteur non configuré : indisponible, jamais une erreur", async () => {
    expect(await reformulerBrouillon(undefined, contexte())).toEqual({
      type: "indisponible",
      raison: "non_configure",
    });
  });

  it("erreur du fournisseur : indisponible", async () => {
    const r = await reformulerBrouillon(
      redacteurFactice({ type: "indisponible", raison: "http_500" }),
      contexte()
    );
    expect(r).toEqual({ type: "indisponible", raison: "http_500" });
  });

  it("timeout : indisponible", async () => {
    const r = await reformulerBrouillon(
      redacteurFactice({ type: "indisponible", raison: "reseau_ou_timeout" }),
      contexte()
    );
    expect(r.type).toBe("indisponible");
  });

  it("exception d'un adaptateur : jamais remontée à l'écran", async () => {
    const r = await reformulerBrouillon(
      redacteurFactice(() => {
        throw new Error("panne interne avec un détail technique");
      }),
      contexte()
    );
    expect(r).toEqual({ type: "indisponible", raison: "exception_adaptateur" });
  });

  it("sortie vide : rejetée par les garde-fous", async () => {
    const r = await reformulerBrouillon(
      redacteurFactice({ type: "reformule", objet: "", corps: "" }),
      contexte()
    );
    expect(r).toEqual({ type: "indisponible", raison: "garde_fou_objet_vide" });
  });

  it("sortie trop longue : rejetée", async () => {
    const r = await reformulerBrouillon(
      redacteurFactice({ type: "reformule", objet: "Objet", corps: "x".repeat(5000) }),
      contexte()
    );
    expect(r).toEqual({ type: "indisponible", raison: "garde_fou_corps_trop_long" });
  });

  it("fait inventé : rejeté entier, jamais corrigé silencieusement", async () => {
    const r = await reformulerBrouillon(
      redacteurFactice({
        type: "reformule",
        objet: OBJET_SOURCE,
        corps: `${CORPS_SOURCE}\nJe vous propose une visite le 15 octobre 2026.`,
      }),
      contexte()
    );
    expect(r.type).toBe("indisponible");
  });

  it("même entrée et rédacteur déterministe : sortie stable", async () => {
    const premier = await reformulerBrouillon(redacteurFactice(REFORMULATION_VALIDE), contexte());
    const second = await reformulerBrouillon(redacteurFactice(REFORMULATION_VALIDE), contexte());
    expect(premier).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe("configuration", () => {
  const variables = ["DOMIORA_REDACTION_BASE_URL", "DOMIORA_REDACTION_MODELE", "DOMIORA_REDACTION_CLE_API"];
  let sauvegarde: Record<string, string | undefined>;

  beforeEach(() => {
    sauvegarde = Object.fromEntries(variables.map((v) => [v, process.env[v]]));
    for (const v of variables) delete process.env[v];
  });

  afterEach(() => {
    for (const v of variables) {
      if (sauvegarde[v] === undefined) delete process.env[v];
      else process.env[v] = sauvegarde[v];
    }
    vi.restoreAllMocks();
  });

  it("aucune variable : fonctionnalité désactivée proprement, jamais une erreur", () => {
    expect(redactionAssisteeDisponible()).toBe(false);
    expect(resoudreRedacteur()).toBeUndefined();
  });

  it("configuration incomplète : toujours désactivée", () => {
    process.env.DOMIORA_REDACTION_BASE_URL = "https://exemple.test/v1";
    expect(redactionAssisteeDisponible()).toBe(false);
  });

  it("base URL et modèle présents : rédacteur disponible, clé facultative", () => {
    process.env.DOMIORA_REDACTION_BASE_URL = "https://exemple.test/v1";
    process.env.DOMIORA_REDACTION_MODELE = "un-modele";
    expect(redactionAssisteeDisponible()).toBe(true);
    expect(resoudreRedacteur()?.nom).toBe("compatible-openai");
  });

  it("aucun secret n'est exposé côté client", () => {
    // Aucune variable de rédaction n'est préfixée NEXT_PUBLIC_ : un préfixe public serait inliné
    // dans le bundle navigateur par Next.
    for (const v of variables) expect(v.startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Frontières de la Server Action
// ---------------------------------------------------------------------------

// Contrôles STRUCTURELS sur le source, même patron que enregistrerCompteRenduVisite.test.ts : ce
// qui compte ici est ce que l'action peut et ne peut PAS faire, une propriété du câblage plutôt que
// d'une exécution.
describe("Server Action de reformulation", () => {
  const source = readFileSync(join(__dirname, "../../actions/reformulerBrouillon.ts"), "utf8");

  it("ne déclenche aucun envoi : ni Gmail, ni tâche, ni relance", () => {
    for (const interdit of ["envoyerEmailGmail", "gmailClient", "creerTache", "terminerTache", "demarrerTentativeEnvoi"]) {
      expect(source).not.toContain(interdit);
    }
  });

  it("ne lit jamais les faits depuis le client : ils sont résolus côté serveur", () => {
    expect(source).toContain("resoudreContexteEcranCommunication");
    expect(source).toContain("projeterFaitsAutorises");
    // Seuls le texte visible, le ton et les identifiants d'écran sont lus du formulaire.
    const champsLus = [...source.matchAll(/formData\.get\("([a-zA-Z]+)"\)/g)].map((m) => m[1]).sort();
    expect([...new Set(champsLus)]).toEqual([
      "acquereurId",
      "bienId",
      "candidat",
      "corps",
      "exigenceCode",
      "notaire",
      "objet",
      "tacheId",
      "ton",
    ]);
  });

  it("exige une session, comme toute Server Action du produit", () => {
    expect(source).toContain("exigerSessionAtlas");
  });

  it("un échec ne rend jamais de motif technique à l'écran", () => {
    expect(source).toContain('{ statut: "indisponible" }');
    expect(source).not.toContain("resultat.raison");
  });
});

describe("texte déjà modifié à la main", () => {
  it("c'est le texte de l'éditeur qui est reformulé, les faits restant ceux du serveur", async () => {
    let recu: ContexteRedactionAugmentee | undefined;
    const modifie = "Bonjour Camille,\n\nJ'ai réécrit ce message moi-même.\n\nCordialement,";
    await reformulerBrouillon(
      redacteurFactice(REFORMULATION_VALIDE, (c) => {
        recu = c;
      }),
      contexte({ corpsActuel: modifie })
    );
    expect(recu!.corpsActuel).toBe(modifie);
    // Les faits autorisés ne dépendent pas du texte édité : ils viennent du contexte serveur.
    expect(recu!.faitsAutorises.bienAdresse).toBe("14 rue des Tilleuls Fictifs");
  });

  it("échec après modification manuelle : le texte courant n'est jamais écrasé", async () => {
    const modifie = "Bonjour Camille,\n\nTexte personnel du conseiller.\n\nCordialement,";
    const r = await reformulerBrouillon(undefined, contexte({ corpsActuel: modifie }));
    // L'action ne rend aucun texte : l'écran conserve donc exactement ce qu'il affichait.
    expect(r.type).toBe("indisponible");
    expect(JSON.stringify(r)).not.toContain("Texte personnel");
  });
});
