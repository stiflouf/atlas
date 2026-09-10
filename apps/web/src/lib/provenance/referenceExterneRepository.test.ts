import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

// ADR-056 §2/§3 — test d'intégration Postgres : le UNIQUE d'identité, le CHECK « exactement une
// cible » et le format de la clé fournisseur n'existent qu'en base.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  contacts: contactsTable,
  projetsAcquereur: projetsAcquereurTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { enregistrerReferenceExterne, listerReferencesDeLEntite, resoudreEntiteCanonique } = await import(
  "./referenceExterneRepository"
);

const contactsCrees: string[] = [];
const projetsCrees: string[] = [];
const biensCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unContact(nom: string, workspaceId: string = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `[test réel] ${nom}` }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unProjet(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 200_000, criteres: [], stadeProjet: "decouverte" },
    workspaceId
  );
  projetsCrees.push(projet.id);
  return projet;
}

async function unBien(workspaceId: string = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] PROVENANCE-${compteur}-${Date.now()}`,
      titre: "Bien de test provenance",
      type: "appartement",
      adresse: "1 rue de la Source",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  biensCrees.push(bien.id);
  return bien;
}

afterAll(async () => {
  const cibles = [...contactsCrees, ...projetsCrees, ...biensCrees];
  if (cibles.length > 0) {
    for (const colonne of [
      referencesExternesTable.contactId,
      referencesExternesTable.projetAcquereurId,
      referencesExternesTable.bienId,
    ]) {
      await getDb().delete(referencesExternesTable).where(inArray(colonne, cibles));
    }
  }
  if (biensCrees.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  if (projetsCrees.length > 0) {
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (contactsCrees.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("references_externes — enregistrer et résoudre une identité", () => {
  it("enregistre une référence et retrouve l'entité canonique depuis l'identité externe", async () => {
    const contact = await unContact("Résolution");
    const identite = { fournisseur: "source_a", typeEntiteExterne: "contact", idExterne: "ext-1" };

    const reference = await enregistrerReferenceExterne(
      { ...identite, cible: { type: "contact", id: contact.id } },
      WORKSPACE_TEST
    );
    expect(reference.cible).toEqual({ type: "contact", id: contact.id });
    expect(reference.vuePourLaPremiereFoisLe).toBeDefined();

    expect(await resoudreEntiteCanonique(identite, WORKSPACE_TEST)).toEqual({
      type: "contact",
      id: contact.id,
    });
  });

  it("revoir la même identité est idempotent et redate seulement la dernière vue", async () => {
    // Le cas normal de chaque pull : l'identité est déjà connue. Ce n'est pas une erreur, et cela
    // ne doit pas créer une seconde ligne.
    const contact = await unContact("Revue");
    const entree = {
      fournisseur: "source_a",
      typeEntiteExterne: "contact",
      idExterne: "ext-revue",
      cible: { type: "contact" as const, id: contact.id },
    };

    const premiere = await enregistrerReferenceExterne(entree, WORKSPACE_TEST);
    const seconde = await enregistrerReferenceExterne(entree, WORKSPACE_TEST);

    expect(seconde.id).toBe(premiere.id);
    expect(seconde.vuePourLaPremiereFoisLe).toBe(premiere.vuePourLaPremiereFoisLe);
    expect(new Date(seconde.vuePourLaDerniereFoisLe).getTime()).toBeGreaterThanOrEqual(
      new Date(premiere.vuePourLaDerniereFoisLe).getTime()
    );
    expect(await listerReferencesDeLEntite({ type: "contact", id: contact.id })).toHaveLength(1);
  });

  it("une entité canonique porte PLUSIEURS identités externes", async () => {
    // ADR-056 invariant 3 : un contact reçu de trois sources est trois faits vrais simultanément.
    const contact = await unContact("Multi-sources");
    for (const fournisseur of ["source_a", "source_b", "source_c"]) {
      await enregistrerReferenceExterne(
        {
          fournisseur,
          typeEntiteExterne: "contact",
          idExterne: "identifiant-partage",
          cible: { type: "contact", id: contact.id },
        },
        WORKSPACE_TEST
      );
    }

    const references = await listerReferencesDeLEntite({ type: "contact", id: contact.id });
    expect(references).toHaveLength(3);
    expect(new Set(references.map((r) => r.fournisseur)).size).toBe(3);
  });

  it("le MÊME identifiant chez deux fournisseurs désigne deux entités différentes", async () => {
    // « 123 » chez A et « 123 » chez B n'ont aucun rapport : le fournisseur fait partie de l'identité.
    const premier = await unContact("Homonyme A");
    const second = await unContact("Homonyme B");

    await enregistrerReferenceExterne(
      { fournisseur: "source_a", typeEntiteExterne: "contact", idExterne: "123", cible: { type: "contact", id: premier.id } },
      WORKSPACE_TEST
    );
    await enregistrerReferenceExterne(
      { fournisseur: "source_b", typeEntiteExterne: "contact", idExterne: "123", cible: { type: "contact", id: second.id } },
      WORKSPACE_TEST
    );

    expect(
      await resoudreEntiteCanonique({ fournisseur: "source_a", typeEntiteExterne: "contact", idExterne: "123" }, WORKSPACE_TEST)
    ).toEqual({ type: "contact", id: premier.id });
    expect(
      await resoudreEntiteCanonique({ fournisseur: "source_b", typeEntiteExterne: "contact", idExterne: "123" }, WORKSPACE_TEST)
    ).toEqual({ type: "contact", id: second.id });
  });

  it("le même identifiant sous deux TYPES externes reste distinct", async () => {
    const contact = await unContact("Types externes");
    const projet = await unProjet();

    await enregistrerReferenceExterne(
      { fournisseur: "source_a", typeEntiteExterne: "contact", idExterne: "77", cible: { type: "contact", id: contact.id } },
      WORKSPACE_TEST
    );
    // Le `buyer` du fournisseur devient un projet acquéreur DOMIORA : deux vocabulaires distincts,
    // conservés tels quels.
    await enregistrerReferenceExterne(
      {
        fournisseur: "source_a",
        typeEntiteExterne: "buyer",
        idExterne: "77",
        cible: { type: "projet_acquereur", id: projet.id },
      },
      WORKSPACE_TEST
    );

    expect(
      await resoudreEntiteCanonique({ fournisseur: "source_a", typeEntiteExterne: "buyer", idExterne: "77" }, WORKSPACE_TEST)
    ).toEqual({ type: "projet_acquereur", id: projet.id });
  });

  it("REFUSE qu'une identité externe désigne une seconde entité canonique", async () => {
    // ADR-056 invariant 2. C'est le refus qui empêche une source de dupliquer une identité en
    // silence — et il vient de la base, pas d'une discipline applicative.
    const premier = await unContact("Collision A");
    const second = await unContact("Collision B");
    const identite = { fournisseur: "source_a", typeEntiteExterne: "contact", idExterne: "collision" };

    await enregistrerReferenceExterne({ ...identite, cible: { type: "contact", id: premier.id } }, WORKSPACE_TEST);
    await expect(
      enregistrerReferenceExterne({ ...identite, cible: { type: "contact", id: second.id } }, WORKSPACE_TEST)
    ).rejects.toThrow(/déjà rattachée à une autre entité/);

    // Et la première référence n'a pas bougé.
    expect(await resoudreEntiteCanonique(identite, WORKSPACE_TEST)).toEqual({ type: "contact", id: premier.id });
  });

  it("deux workspaces peuvent recevoir la MÊME identité externe sans collision", async () => {
    // Ils parlent à deux comptes différents du même fournisseur : ce n'est pas un conflit, et
    // l'interdire ferait perdre une identité vraie.
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-provenance", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);

    const ici = await unContact("Workspace ici");
    const ailleurs = await unContact("Workspace ailleurs", autreWorkspace.id);
    const identite = { fournisseur: "source_a", typeEntiteExterne: "contact", idExterne: "meme-id" };

    await enregistrerReferenceExterne({ ...identite, cible: { type: "contact", id: ici.id } }, WORKSPACE_TEST);
    await enregistrerReferenceExterne(
      { ...identite, cible: { type: "contact", id: ailleurs.id } },
      autreWorkspace.id
    );

    expect(await resoudreEntiteCanonique(identite, WORKSPACE_TEST)).toEqual({ type: "contact", id: ici.id });
    expect(await resoudreEntiteCanonique(identite, autreWorkspace.id)).toEqual({
      type: "contact",
      id: ailleurs.id,
    });
  });

  it("refuse une référence visant une entité d'un autre workspace", async () => {
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-provenance-2", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);
    const contactAilleurs = await unContact("Cible ailleurs", autreWorkspace.id);

    await expect(
      enregistrerReferenceExterne(
        {
          fournisseur: "source_a",
          typeEntiteExterne: "contact",
          idExterne: "hors-perimetre",
          cible: { type: "contact", id: contactAilleurs.id },
        },
        WORKSPACE_TEST
      )
    ).rejects.toThrow(/autre workspace/);
  });

  it("refuse une entité canonique inexistante plutôt qu'une référence orpheline", async () => {
    await expect(
      enregistrerReferenceExterne(
        {
          fournisseur: "source_a",
          typeEntiteExterne: "contact",
          idExterne: "fantome",
          cible: { type: "contact", id: "00000000-0000-0000-0000-000000000000" },
        },
        WORKSPACE_TEST
      )
    ).rejects.toThrow(/Entité canonique introuvable/);
  });

  it("refuse zéro ou deux cibles — le CHECK, pas une convention", async () => {
    const contact = await unContact("Cibles");
    const bien = await unBien();

    await expect(
      getDb().insert(referencesExternesTable).values({
        workspaceId: WORKSPACE_TEST,
        fournisseur: "source_a",
        typeEntiteExterne: "contact",
        idExterne: "sans-cible",
      })
    ).rejects.toThrow();

    await expect(
      getDb().insert(referencesExternesTable).values({
        workspaceId: WORKSPACE_TEST,
        fournisseur: "source_a",
        typeEntiteExterne: "contact",
        idExterne: "deux-cibles",
        contactId: contact.id,
        bienId: bien.id,
      })
    ).rejects.toThrow();
  });

  it("le fournisseur doit être une clé technique, jamais un libellé", async () => {
    // Il vivra dans des clés d'unicité et des logs pendant des années : un renommage marketing ne
    // doit pas pouvoir casser des identités.
    const contact = await unContact("Clé technique");
    await expect(
      enregistrerReferenceExterne(
        {
          fournisseur: "Playiad (réseau)",
          typeEntiteExterne: "contact",
          idExterne: "libelle",
          cible: { type: "contact", id: contact.id },
        },
        WORKSPACE_TEST
      )
    ).rejects.toThrow();
  });

  it("une identité inconnue ne résout rien, sans erreur", async () => {
    expect(
      await resoudreEntiteCanonique(
        { fournisseur: "source_inconnue", typeEntiteExterne: "contact", idExterne: "jamais-vu" },
        WORKSPACE_TEST
      )
    ).toBeUndefined();
    expect(await listerReferencesDeLEntite({ type: "contact", id: "pas-un-uuid" })).toEqual([]);
  });
});
