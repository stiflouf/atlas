import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §B — test d'intégration Postgres : ce qui est vérifié ici (le pont réel
// `acquereurs.projet_acquereur_id`, la jointure, la traduction NULL -> undefined) n'existe qu'en
// base. Un mock prouverait seulement que le mock a été écrit conformément à l'attente.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  projetsAcquereur: projetsAcquereurTable,
} = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { resoudreProfilCompatibilite, resoudreProfilsCompatibilite } = await import("./profilCompatibiliteRepository");
const { clients: clientsDemo } = await import("@/data/clients");

type ProfilAcquereur = Awaited<ReturnType<typeof creerAcquereur>>;

const acquereursCrees: string[] = [];
const projetsCrees: string[] = [];
const contactsCrees: string[] = [];

afterAll(async () => {
  if (acquereursCrees.length > 0) {
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, acquereursCrees));
  }
  if (projetsCrees.length > 0) {
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
});

// Critères du DOSSIER historique — volontairement tous renseignés, pour qu'un repli involontaire
// vers le legacy soit visible sur n'importe lequel d'entre eux.
const CRITERES_DOSSIER = {
  budgetMin: 100_000,
  budgetMax: 400_000,
  piecesMin: 4,
  surfaceMin: 90,
  accessibiliteRequise: true,
  necessiteParking: true,
  necessiteExterieur: true,
};

async function unDossier(suffixe: string, surcharge: Record<string, unknown> = {}) {
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `[test réel] Profil ${suffixe}`,
      email: `test-reel-profil-${suffixe}@example.com`,
      telephone: "0600000000",
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      ...CRITERES_DOSSIER,
      ...surcharge,
    },
    WORKSPACE_TEST
  );
  acquereursCrees.push(acquereur.id);
  return acquereur;
}

async function unProjet(surcharge: Record<string, unknown> = {}) {
  const contact = await creerContact({ nom: "[test réel] Profil" }, WORKSPACE_TEST);
  contactsCrees.push(contact.id);
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 250_000, criteres: [], stadeProjet: "decouverte", ...surcharge },
    WORKSPACE_TEST
  );
  projetsCrees.push(projet.id);
  return projet;
}

describe("resoudreProfilsCompatibilite — la règle de source (ADR-055 §B)", () => {
  it("A. un dossier SANS projet canonique garde exactement ses critères historiques", async () => {
    // Les 4 acquéreurs historiques de domiora-demo sont dans cet état, et ils doivent matcher
    // comme avant ce lot — c'est la moitié non négociable de la règle.
    const dossier = await unDossier("legacy");
    const profil = await resoudreProfilCompatibilite(dossier);

    expect(profil).toEqual({
      id: dossier.id,
      budgetMax: 400_000,
      piecesMin: 4,
      surfaceMin: 90,
      accessibiliteRequise: true,
      necessiteParking: true,
      necessiteExterieur: true,
    });
  });

  it("B. un dossier AVEC projet canonique lit le projet, jamais le dossier", async () => {
    // Divergence volontaire sur TOUS les champs : aucun ne peut passer par hasard.
    const projet = await unProjet({
      budgetMax: 250_000,
      piecesMin: 2,
      surfaceMin: 30,
      accessibiliteRequise: false,
      necessiteParking: false,
      necessiteExterieur: false,
    });
    const dossier = await unDossier("canonique", { projetAcquereurId: projet.id });

    const profil = await resoudreProfilCompatibilite(dossier);

    expect(profil).toEqual({
      id: dossier.id, // l'id reste celui du DOSSIER : c'est lui que porte ResultatCompatibilite
      budgetMax: 250_000,
      piecesMin: 2,
      surfaceMin: 30,
      accessibiliteRequise: false,
      necessiteParking: false,
      necessiteExterieur: false,
    });
  });

  it("C. un critère NULL sur le projet reste NON DOCUMENTÉ — aucun repli champ par champ", async () => {
    // Le cœur de la règle. Le dossier porte piecesMin=4 et surfaceMin=90 ; le projet ne les
    // documente pas. Les reprendre du dossier ressusciterait un critère qu'une source vient
    // peut-être d'effacer, et rendrait indécidable ce que le produit affiche.
    const projet = await unProjet({ budgetMax: 250_000 });
    const dossier = await unDossier("nulls", { projetAcquereurId: projet.id });

    const profil = await resoudreProfilCompatibilite(dossier);

    expect(profil.budgetMax).toBe(250_000);
    expect(profil.piecesMin).toBeUndefined();
    expect(profil.surfaceMin).toBeUndefined();
    expect(profil.accessibiliteRequise).toBeUndefined();
    expect(profil.necessiteParking).toBeUndefined();
    expect(profil.necessiteExterieur).toBeUndefined();
  });

  it("D. une référence de projet cassée échoue bruyamment — jamais un repli silencieux", async () => {
    // La FK rend ce cas impossible en base : il n'est donc pas produit par une écriture réelle mais
    // par un exécuteur qui rend exactement ce que rendrait une base incohérente. Retomber sur le
    // legacy présenterait des critères périmés comme canoniques — un mensonge stable.
    const executeurIncoherent = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: async () => [
              {
                acquereurId: "00000000-0000-4000-8000-000000000001",
                projetAcquereurId: "00000000-0000-4000-8000-0000000000ff",
                projetTrouveId: null,
                budgetMax: null,
                piecesMin: null,
                surfaceMin: null,
                accessibiliteRequise: null,
                necessiteParking: null,
                necessiteExterieur: null,
              },
            ],
          }),
        }),
      }),
    };
    const dossierFantome = {
      ...CRITERES_DOSSIER,
      id: "00000000-0000-4000-8000-000000000001",
      prenom: "Test",
      nom: "Fantôme",
      email: "x@example.com",
      telephone: "0600000000",
      criteres: [],
      stadeProjet: "decouverte" as const,
      notes: "",
      datePremiereContact: "2026-01-01",
    };

    await expect(
      resoudreProfilCompatibilite(dossierFantome, executeurIncoherent as never)
    ).rejects.toThrow(/Projet acquéreur référencé mais introuvable/);
  });

  it("E. la source est décidée par le PONT seul, jamais par un rapprochement", async () => {
    // Deux dossiers d'identité strictement identique, un seul rattaché : leurs profils diffèrent.
    // Aucun rapprochement par nom, email ou téléphone ne doit jamais entrer dans cette résolution
    // (ADR-055 §H, ADR-056 §3).
    const projet = await unProjet({ budgetMax: 210_000 });
    const rattache = await unDossier("jumeau-rattache", { projetAcquereurId: projet.id });
    const nonRattache = await unDossier("jumeau-libre", {
      nom: rattache.nom,
      email: rattache.email,
      telephone: rattache.telephone,
    });

    const [profilRattache, profilLibre] = await resoudreProfilsCompatibilite([rattache, nonRattache]);

    expect(profilRattache.budgetMax).toBe(210_000);
    expect(profilLibre.budgetMax).toBe(400_000);
  });

  it("préserve l'ordre d'entrée et n'invente rien pour un acquéreur non persisté", async () => {
    // listerClients() sert le jeu de démonstration tant qu'aucun acquéreur réel n'existe : ses ids
    // ne sont pas des UUID et n'ont aucune ligne. Le dossier en mémoire est alors la seule donnée
    // qui existe — exactement le comportement d'avant ce lot.
    const demo = clientsDemo[0] as ProfilAcquereur;
    const dossier = await unDossier("ordre");

    const profils = await resoudreProfilsCompatibilite([demo, dossier]);

    expect(profils.map((p) => p.id)).toEqual([demo.id, dossier.id]);
    expect(profils[0]!.budgetMax).toBe(demo.budgetMax);
  });

  it("ne lit ni n'écrit rien d'autre : le dossier historique est intact après résolution", async () => {
    const projet = await unProjet({ budgetMax: 250_000 });
    const dossier = await unDossier("intact", { projetAcquereurId: projet.id });

    await resoudreProfilCompatibilite(dossier);

    const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, dossier.id));
    expect(ligne!.budgetMax).toBe(400_000);
    expect(ligne!.piecesMin).toBe(4);
    expect(ligne!.projetAcquereurId).toBe(projet.id);
  });
});
