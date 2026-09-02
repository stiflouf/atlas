import { describe, expect, it } from "vitest";
import {
  MAXIMUM_EVENEMENTS_MEMOIRE,
  construireMemoireRelationnelleAcquereur,
  selectionnerTachesLieesAcquereur,
  type MemoireRelationnelleAcquereur,
} from "./memoireAcquereur";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { Compromis } from "@/types/compromis";
import type { EnvoiEmail } from "@/types/envoiEmail";
import type { Offre } from "@/types/offre";
import type { Opportunite } from "@/types/opportunite";
import type { SecteurRecherche } from "@/types/secteurRecherche";
import type { Tache } from "@/types/tache";
import type { Visite } from "@/types/visite";

const MAINTENANT = new Date("2026-09-02T09:00:00.000Z");
const AUJOURD_HUI = "2026-09-02";

const BIEN_PIVOT = { id: "b1", reference: "DEMO-2026-001", adresse: "14 rue des Tilleuls Fictifs" } as Bien;
const BIEN_MAISON = { id: "b2", reference: "DEMO-2026-002", adresse: "3 allée des Charmes Fictive" } as Bien;
const BIENS = new Map<string, Bien | undefined>([
  [BIEN_PIVOT.id, BIEN_PIVOT],
  [BIEN_MAISON.id, BIEN_MAISON],
]);

// Camille Ferrand, telle que le seed de démonstration la produit : recherche active, une visite
// encore à venir, une tâche active, aucun compte rendu.
const CAMILLE: ProfilAcquereur = {
  id: "a1",
  prenom: "Camille",
  nom: "Ferrand",
  email: "camille.ferrand@example.test",
  telephone: "0100000001",
  budgetMin: 320_000,
  budgetMax: 420_000,
  criteres: ["Proximité gare", "Balcon ou terrasse", "Stationnement"],
  stadeProjet: "recherche_active",
  notes: "Prêt bancaire accordé, disponible pour visiter en semaine.",
  datePremiereContact: "2026-07-26",
  piecesMin: 3,
  surfaceMin: 70,
  necessiteParking: true,
  necessiteExterieur: true,
};

// Théo Marchand : la relation longue — visite réalisée, compte rendu, offre, acceptation,
// compromis, plus une tâche portée par le compromis (jamais par l'acquéreur).
const THEO: ProfilAcquereur = {
  ...CAMILLE,
  id: "a4",
  prenom: "Théo",
  nom: "Marchand",
  budgetMin: 650_000,
  budgetMax: 780_000,
  stadeProjet: "compromis",
  criteres: ["Maison familiale"],
  notes: "Compromis signé sur la maison de Maisons-Laffitte.",
  datePremiereContact: "2026-05-30",
  piecesMin: 4,
  surfaceMin: 110,
  necessiteParking: undefined,
  necessiteExterieur: true,
};

const SECTEUR_HOUILLES: SecteurRecherche = {
  id: "s1",
  acquereurId: CAMILLE.id,
  codeInsee: "78311",
  nomCommune: "Houilles",
  codePostal: "78800",
  creeLe: "2026-07-26T10:00:00.000Z",
};

function tache(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "t-generique",
    titre: "Tâche",
    type: "relance",
    priorite: "normale",
    origine: "manuelle",
    creeLe: "2026-08-31T09:00:00.000Z",
    ...surcharge,
  };
}

function memoire(surcharge: Partial<Parameters<typeof construireMemoireRelationnelleAcquereur>[0]> = {}) {
  return construireMemoireRelationnelleAcquereur({
    acquereur: CAMILLE,
    secteurs: [],
    visites: [],
    comptesRendus: [],
    offres: [],
    compromis: [],
    tachesLiees: [],
    envois: [],
    opportunites: [],
    biensParId: BIENS,
    maintenant: MAINTENANT,
    aujourdHui: AUJOURD_HUI,
    ...surcharge,
  });
}

const titres = (m: MemoireRelationnelleAcquereur) => m.historique.map((e) => e.titre);
const types = (m: MemoireRelationnelleAcquereur) => m.historique.map((e) => e.type);

// ---------------------------------------------------------------------------
// Cas de référence
// ---------------------------------------------------------------------------

const VISITE_CAMILLE: Visite = {
  id: "v2",
  bienId: BIEN_PIVOT.id,
  acquereurId: CAMILLE.id,
  datePrevue: "2026-09-06",
  statut: "planifiee",
  rendezVousCalendarId: "demo-seed-visite-002",
  creeLe: "2026-08-31T09:00:00.000Z",
};

const TACHE_CAMILLE = tache({
  id: "t5",
  titre: "Proposer une seconde visite à Camille Ferrand",
  contexte: "Première visite programmée cette semaine.",
  type: "appel",
  echeance: "2026-09-06",
  acquereurId: CAMILLE.id,
});

function memoireCamille() {
  return memoire({
    secteurs: [SECTEUR_HOUILLES],
    visites: [VISITE_CAMILLE],
    tachesLiees: [TACHE_CAMILLE],
  });
}

describe("Camille Ferrand — relation en cours", () => {
  it("état actuel : recherche active et visite prévue, sans état commercial inventé", () => {
    const m = memoireCamille();
    expect(m.etatActuel.libelle).toBe("Recherche active");
    expect(m.etatActuel.precisions).toEqual(["Visite prévue le 6 septembre 2026"]);
  });

  it("faits à retenir : budget, secteur et contraintes réellement posées", () => {
    const m = memoireCamille();
    expect(m.faitsARetenir.map((f) => f.cle)).toEqual([
      "budget",
      "secteurs",
      "pieces",
      "surface",
      "exterieur",
      "parking",
    ]);
    // Intl.NumberFormat("fr-FR") sépare les milliers par une espace insécable fine (U+202F) —
    // comparée telle quelle, jamais normalisée : c'est bien ce caractère qui est rendu.
    expect(m.faitsARetenir[0].valeur).toBe("420 000 €");
    expect(m.faitsARetenir[1].valeur).toBe("Houilles");
  });

  it("historique : premier contact et visite prévue, rien d'autre", () => {
    expect(types(memoireCamille())).toEqual(["visite_prevue", "premier_contact"]);
  });

  it("à faire maintenant : la tâche réellement persistée", () => {
    const m = memoireCamille();
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]).toMatchObject({
      source: "tache",
      titre: "Proposer une seconde visite à Camille Ferrand",
    });
  });
});

const VISITE_THEO: Visite = {
  id: "v1",
  bienId: BIEN_MAISON.id,
  acquereurId: THEO.id,
  datePrevue: "2026-08-24",
  statut: "realisee",
  rendezVousCalendarId: "demo-seed-visite-001",
  creeLe: "2026-08-21T09:00:00.000Z",
};

const CR_THEO: CompteRenduVisite = {
  id: "cr1",
  bienId: BIEN_MAISON.id,
  acquereurId: THEO.id,
  visiteId: VISITE_THEO.id,
  dateVisite: "2026-08-24",
  retour: "Le jardin et le volume du séjour ont emporté la décision. Réserve sur la cuisine.",
  interet: "interesse",
  prochaineEtape: "Faire une offre écrite",
  creeLe: "2026-08-24T18:00:00.000Z",
};

const OFFRE_THEO: Offre = {
  id: "o1",
  bienId: BIEN_MAISON.id,
  acquereurId: THEO.id,
  montant: 730_000,
  dateOffre: "2026-08-27",
  statut: "acceptee",
  dateValidite: "2026-09-06",
  dateDecision: "2026-08-29",
  creeLe: "2026-08-27T09:00:00.000Z",
};

const COMPROMIS_THEO: Compromis = {
  id: "c1",
  bienId: BIEN_MAISON.id,
  acquereurId: THEO.id,
  offreId: OFFRE_THEO.id,
  prixConvenu: 730_000,
  dateSignature: "2026-08-31",
  dateActe: "2026-11-16",
  statut: "en_cours",
  creeLe: "2026-08-31T09:00:00.000Z",
};

const TACHE_NOTAIRE = tache({
  id: "t3",
  titre: "Confirmer la date de l'acte avec l'étude notariale",
  contexte: "Compromis signé, acte prévu dans environ deux mois et demi.",
  type: "appel",
  priorite: "haute",
  echeance: "2026-09-03",
  compromisId: COMPROMIS_THEO.id,
});

function memoireTheo(surcharge: Partial<Parameters<typeof construireMemoireRelationnelleAcquereur>[0]> = {}) {
  return memoire({
    acquereur: THEO,
    visites: [VISITE_THEO],
    comptesRendus: [CR_THEO],
    offres: [OFFRE_THEO],
    compromis: [COMPROMIS_THEO],
    tachesLiees: [TACHE_NOTAIRE],
    ...surcharge,
  });
}

describe("Théo Marchand — relation avancée", () => {
  it("état actuel : le fait le plus avancé, jamais la pile des anciens états", () => {
    const m = memoireTheo();
    expect(m.etatActuel.libelle).toBe("Compromis");
    expect(m.etatActuel.precisions).toEqual(["Compromis signé, acte prévu le 16 novembre 2026"]);
    expect(m.etatActuel.precisions.join(" ")).not.toContain("Offre acceptée");
  });

  it("historique : la trajectoire commerciale complète, du plus récent au plus ancien", () => {
    expect(types(memoireTheo())).toEqual([
      "compromis_signe",
      "offre_decidee",
      "offre_deposee",
      "visite_realisee",
      "premier_contact",
    ]);
  });

  it("la visite réalisée porte l'intérêt structuré, jamais le retour libre", () => {
    const visite = memoireTheo().historique.find((e) => e.type === "visite_realisee")!;
    expect(visite.detail).toBe("Intérêt : Intéressé");
    expect(visite.date).toBe(VISITE_THEO.datePrevue);
    expect(JSON.stringify(memoireTheo())).not.toContain("jardin");
  });

  it("à faire maintenant : la tâche portée par le compromis, remontée par FK", () => {
    const m = memoireTheo();
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0].titre).toBe("Confirmer la date de l'acte avec l'étude notariale");
    // `compromis` n'a aucune fiche navigable (types/tache.ts) : jamais un lien construit à l'aveugle.
    expect(m.actions[0].href).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Déterminisme
// ---------------------------------------------------------------------------

describe("déterminisme", () => {
  it("mêmes données deux fois : mêmes ids et même ordre", () => {
    expect(memoireTheo().historique).toEqual(memoireTheo().historique);
    expect(memoireTheo().historique.map((e) => e.id)).toEqual([
      "compromis_signe:c1",
      "offre_decidee:o1",
      "offre_deposee:o1",
      "visite_realisee:v1",
      "premier_contact:a4",
    ]);
  });

  it("l'ordre ne dépend pas de l'ordre d'entrée des collections", () => {
    const inverse = memoireTheo({
      offres: [OFFRE_THEO],
      compromis: [COMPROMIS_THEO],
      visites: [VISITE_THEO],
    });
    expect(inverse.historique.map((e) => e.id)).toEqual(memoireTheo().historique.map((e) => e.id));
  });

  it("aucune donnée : aucun faux historique, aucune action inventée", () => {
    const m = memoire();
    // Seul le premier contact, qui est une date réellement saisie sur la fiche.
    expect(types(m)).toEqual(["premier_contact"]);
    expect(m.actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dates : jamais fabriquées
// ---------------------------------------------------------------------------

describe("dates", () => {
  it("visite réalisée : datée à la date prévue, jamais à creeLe", () => {
    const evenement = memoireTheo().historique.find((e) => e.type === "visite_realisee")!;
    expect(evenement.date).toBe("2026-08-24");
    expect(evenement.date).not.toBe(VISITE_THEO.creeLe);
  });

  it("offre sans dateDecision : aucun événement de décision, jamais une date de repli", () => {
    const m = memoireTheo({
      offres: [{ ...OFFRE_THEO, dateDecision: undefined }],
      compromis: [],
      tachesLiees: [],
    });
    expect(types(m)).not.toContain("offre_decidee");
    expect(types(m)).toContain("offre_deposee");
  });

  it("compromis réalisé : daté par dateActeReelle, jamais par dateActe prévue", () => {
    const m = memoireTheo({
      compromis: [{ ...COMPROMIS_THEO, statut: "realise", dateActeReelle: "2026-11-20" }],
    });
    const acte = m.historique.find((e) => e.type === "compromis_finalise")!;
    expect(acte.date).toBe("2026-11-20");
    expect(m.etatActuel.precisions).toEqual(["Acte signé le 20 novembre 2026"]);
  });

  it("visite annulée : datée à la date prévue, sans prétendre à une date d'annulation", () => {
    const m = memoire({ visites: [{ ...VISITE_CAMILLE, statut: "annulee" }] });
    const evenement = m.historique.find((e) => e.type === "visite_annulee")!;
    expect(evenement.date).toBe(VISITE_CAMILLE.datePrevue);
    expect(m.etatActuel.precisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

function envoi(surcharge: Partial<EnvoiEmail> = {}): EnvoiEmail {
  return {
    id: "e1",
    destinataireEmail: "camille.ferrand@example.test",
    objet: "Suite à notre visite",
    contenuHash: "hash",
    fournisseur: "gmail",
    tacheId: TACHE_CAMILLE.id,
    demarreLe: "2026-09-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("emails réellement envoyés", () => {
  it("un envoi réussi devient un événement, daté par reussiLe, objet seul", () => {
    const m = memoire({
      tachesLiees: [TACHE_CAMILLE],
      envois: [envoi({ reussiLe: "2026-09-01T10:00:05.000Z", gmailMessageId: "gmail-1" })],
    });
    const evenement = m.historique.find((e) => e.type === "email_envoye")!;
    expect(evenement).toMatchObject({ titre: "Email envoyé", detail: "Suite à notre visite" });
    expect(evenement.date).toBe("2026-09-01T10:00:05.000Z");
  });

  it("tentative en cours (aucun timestamp terminal) : jamais présentée comme envoyée", () => {
    const m = memoire({ envois: [envoi()] });
    expect(types(m)).not.toContain("email_envoye");
  });

  it("envoi incertain : jamais présenté comme envoyé", () => {
    const m = memoire({
      envois: [envoi({ incertainLe: "2026-09-01T10:00:05.000Z", erreurTechnique: "timeout_reseau" })],
    });
    expect(types(m)).not.toContain("email_envoye");
  });

  it("envoi échoué : jamais présenté comme un fait relationnel positif", () => {
    const m = memoire({
      envois: [envoi({ echoueLe: "2026-09-01T10:00:05.000Z", erreurTechnique: "destinataire_invalide" })],
    });
    expect(types(m)).not.toContain("email_envoye");
    expect(JSON.stringify(m)).not.toContain("destinataire_invalide");
  });
});

// ---------------------------------------------------------------------------
// Tâches, VALUE-01, VALUE-02
// ---------------------------------------------------------------------------

const OPPORTUNITE_MATCH: Opportunite = {
  id: "match_a_exploiter:acquereur:a1:b1",
  type: "match_a_exploiter",
  priorite: "moyenne",
  cible: { type: "acquereur", id: CAMILLE.id },
  titre: "Proposer DEMO-2026-001 à Camille Ferrand",
  raison: "Aucune visite n'est enregistrée sur ce rapprochement.",
  action: { libelle: "Voir l'acquéreur", href: "/clients/a1" },
};

describe("À faire maintenant — priorité de source", () => {
  it("une opportunité non absorbée par une tâche est visible", () => {
    const m = memoire({ opportunites: [OPPORTUNITE_MATCH] });
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]).toMatchObject({ source: "opportunite", href: "/clients/a1" });
  });

  it("une opportunité déjà absorbée par le moteur n'arrive jamais ici : aucun doublon", () => {
    // Le moteur VALUE-01 ne restitue pas l'opportunité couverte par une tâche active sur la même
    // cible — la mémoire ne rejoue donc aucune règle de déduplication.
    const m = memoire({ tachesLiees: [TACHE_CAMILLE], opportunites: [] });
    expect(m.actions.map((a) => a.source)).toEqual(["tache"]);
    expect(m.actions).toHaveLength(1);
  });

  it("les tâches passent avant les opportunités, et la liste reste courte", () => {
    const m = memoire({
      tachesLiees: [
        TACHE_CAMILLE,
        tache({ id: "t9", titre: "Rappeler pour le financement", acquereurId: CAMILLE.id }),
      ],
      opportunites: [OPPORTUNITE_MATCH],
    });
    expect(m.actions.map((a) => a.source)).toEqual(["tache", "tache", "opportunite"]);
  });

  it("une opportunité visant un autre dossier n'apparaît jamais sur cette fiche", () => {
    const m = memoire({
      opportunites: [
        { ...OPPORTUNITE_MATCH, cible: { type: "prospectVendeur", id: "p1" }, type: "relance_prospect_vendeur" },
        { ...OPPORTUNITE_MATCH, id: "autre", cible: { type: "acquereur", id: "a9" } },
      ],
    });
    expect(m.actions).toEqual([]);
  });

  it("une tâche terminée est un fait passé, jamais une action en attente", () => {
    const terminee = tache({
      id: "t6",
      titre: "Envoyer l'avis de valeur",
      acquereurId: CAMILLE.id,
      termineeLe: "2026-08-29T09:00:00.000Z",
    });
    const m = memoire({ tachesLiees: [terminee] });
    expect(m.actions).toEqual([]);
    expect(titres(m)).toContain("Tâche terminée : Envoyer l'avis de valeur");
  });
});

describe("selectionnerTachesLieesAcquereur", () => {
  it("retient l'acquéreur et les objets nés de sa relation, jamais un dossier voisin", () => {
    const retenues = selectionnerTachesLieesAcquereur(
      [
        TACHE_CAMILLE,
        TACHE_NOTAIRE,
        tache({ id: "tv", titre: "Sur la visite", visiteId: VISITE_THEO.id }),
        tache({ id: "to", titre: "Sur l'offre", offreId: OFFRE_THEO.id }),
        tache({ id: "tb", titre: "Sur le bien", bienId: BIEN_MAISON.id }),
        tache({ id: "tp", titre: "Sur un vendeur", prospectVendeurId: "p1" }),
      ],
      CAMILLE.id,
      [VISITE_THEO],
      [OFFRE_THEO],
      [COMPROMIS_THEO]
    );
    expect(retenues.map((t) => t.id)).toEqual(["t5", "t3", "tv", "to"]);
  });
});

// ---------------------------------------------------------------------------
// Frontière texte libre
// ---------------------------------------------------------------------------

describe("textes libres", () => {
  it("une note acquéreur sensible n'atteint jamais la mémoire structurée", () => {
    const sensible = "client difficile, financement douteux";
    const m = memoire({
      acquereur: { ...CAMILLE, notes: sensible, criteres: ["ne pas insister", "profil compliqué"] },
      secteurs: [SECTEUR_HOUILLES],
      visites: [VISITE_CAMILLE],
      tachesLiees: [TACHE_CAMILLE],
    });
    const serialise = JSON.stringify(m);
    for (const mot of ["difficile", "douteux", "insister", "compliqué"]) {
      expect(serialise).not.toContain(mot);
    }
  });

  it("les notes n'altèrent jamais les faits déterminés", () => {
    const avec = memoire({ acquereur: { ...CAMILLE, notes: "client difficile" }, visites: [VISITE_CAMILLE] });
    const sans = memoire({ acquereur: { ...CAMILLE, notes: "" }, visites: [VISITE_CAMILLE] });
    expect(avec).toEqual(sans);
  });
});

// ---------------------------------------------------------------------------
// Densité
// ---------------------------------------------------------------------------

describe("densité de lecture", () => {
  it("historique dense : plafonné, et ce sont les jalons commerciaux qui restent", () => {
    const tachesTerminees = Array.from({ length: 10 }, (_, i) =>
      tache({
        id: `tt${i}`,
        titre: `Tâche terminée ${i}`,
        acquereurId: THEO.id,
        termineeLe: `2026-09-0${(i % 9) + 1}T09:00:00.000Z`,
      })
    );
    const m = memoireTheo({ tachesLiees: [TACHE_NOTAIRE, ...tachesTerminees] });

    expect(m.historique).toHaveLength(MAXIMUM_EVENEMENTS_MEMOIRE);
    // Les quatre jalons majeurs survivent malgré dix faits plus récents.
    for (const type of ["compromis_signe", "offre_decidee", "offre_deposee", "visite_realisee"]) {
      expect(types(m)).toContain(type);
    }
    // Le premier contact, contexte de moindre importance, est le premier sacrifié.
    expect(types(m)).not.toContain("premier_contact");
  });

  it("la sélection dense reste stable d'un appel à l'autre", () => {
    const tachesTerminees = Array.from({ length: 10 }, (_, i) =>
      tache({ id: `tt${i}`, titre: `Tâche ${i}`, acquereurId: THEO.id, termineeLe: "2026-09-01T09:00:00.000Z" })
    );
    const premier = memoireTheo({ tachesLiees: tachesTerminees }).historique.map((e) => e.id);
    const second = memoireTheo({ tachesLiees: tachesTerminees }).historique.map((e) => e.id);
    expect(premier).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Cas limites
// ---------------------------------------------------------------------------

describe("cas limites", () => {
  it("compte rendu antérieur à ADR-040 (sans visite Atlas) : le fait reste daté et visible", () => {
    const m = memoire({
      comptesRendus: [{ ...CR_THEO, id: "cr-ancien", visiteId: undefined, acquereurId: CAMILLE.id }],
    });
    const evenement = m.historique.find((e) => e.type === "visite_realisee")!;
    expect(evenement.id).toBe("visite_realisee:cr:cr-ancien");
    expect(evenement.href).toBeUndefined();
  });

  it("un compte rendu déjà rattaché à sa visite ne produit jamais un second événement", () => {
    expect(types(memoireTheo()).filter((t) => t === "visite_realisee")).toHaveLength(1);
  });

  it("fiche archivée : le fait est dit, sans masquer le reste de la mémoire", () => {
    const m = memoire({
      acquereur: { ...CAMILLE, archiveLe: "2026-09-01T09:00:00.000Z" },
      visites: [VISITE_CAMILLE],
    });
    expect(m.etatActuel.precisions[0]).toBe("Fiche archivée");
    expect(m.historique.length).toBeGreaterThan(0);
  });

  it("bien introuvable : constat honnête, jamais un titre inventé", () => {
    const m = memoire({
      offres: [{ ...OFFRE_THEO, bienId: "inconnu" }],
      biensParId: new Map(),
    });
    expect(m.historique.find((e) => e.type === "offre_deposee")!.detail).toBe("bien indisponible");
  });

  it("contrainte non renseignée ou explicitement non requise : jamais un fait à retenir", () => {
    const m = memoire({
      acquereur: { ...CAMILLE, necessiteParking: false, necessiteExterieur: undefined, accessibiliteRequise: false },
    });
    expect(m.faitsARetenir.map((f) => f.cle)).toEqual(["budget", "pieces", "surface"]);
  });
});
