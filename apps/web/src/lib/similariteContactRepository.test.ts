import { afterAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §H — la détection SIGNALE, elle ne conclut pas. Ce que ces tests fixent : seuls un email
// ou un téléphone normalisés font remonter un candidat ; un nom identique n'y suffit jamais ; tout
// Contact partageant une clé est rendu, sans regroupement ; rien n'est écrit.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { trouverContactsSimilaires, LIMITE_CANDIDATS } = await import("@/lib/similariteContactRepository");
const { cleTelephoneSql, cleEmailSql, cleNomPrenom } = await import("@/lib/similariteContactNormalisation");

// Marqueur unique : la base est partagée par toute la suite. Chaque test emploie des emails et
// des numéros qui lui sont propres, pour qu'aucun autre fichier ne fasse remonter un candidat.
const M = `Zsim${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;
// Numéros à 10 chiffres, uniques par test, jamais réels : préfixe 09 + 8 chiffres dérivés.
const unTelephone = () => `09${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++compteur).padStart(2, "0")}`;

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0)
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (idsWorkspaces.length > 0)
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string },
  workspace = WORKSPACE_TEST
) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjetAcquereur(contactId: string) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 200_000, budgetMax: 500_000, criteres: [], stadeProjet: "recherche_active" },
    WORKSPACE_TEST
  );
  idsProjetsA.push(projet.id);
  await ajouterPartieProjet({ contactId, projetAcquereurId: projet.id, role: "acquereur" });
  return projet;
}

async function unProjetVendeur(contactId: string) {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  await ajouterPartieProjet({ contactId, projetVendeurId: projet.id, role: "vendeur" });
  return projet;
}

const similaires = (contactId: string, workspace = WORKSPACE_TEST) =>
  trouverContactsSimilaires(contactId, workspace);

async function cleTelephone(valeur: string): Promise<string | null> {
  const resultat = await getDb().execute(sql`select ${cleTelephoneSql(sql`${valeur}::text`)} as cle`);
  return (resultat as unknown as { cle: string | null }[])[0].cle;
}

async function cleEmail(valeur: string): Promise<string | null> {
  const resultat = await getDb().execute(sql`select ${cleEmailSql(sql`${valeur}::text`)} as cle`);
  return (resultat as unknown as { cle: string | null }[])[0].cle;
}

describe("normalisation email (détection uniquement)", () => {
  it("A/B. trim + minuscules, rien d'autre", async () => {
    expect(await cleEmail("  Jean@Example.COM ")).toBe("jean@example.com");
    // Aucune règle Gmail : les points et le +tag sont conservés tels quels.
    expect(await cleEmail("jean.martin+crm@gmail.com")).toBe("jean.martin+crm@gmail.com");
    expect(await cleEmail("   ")).toBeNull();
  });
});

describe("normalisation téléphone (détection uniquement)", () => {
  it("C/D/E. 06, +33 et 0033 ont la même clé", async () => {
    expect(await cleTelephone("06 12 34 56 78")).toBe("0612345678");
    expect(await cleTelephone("+33 6 12 34 56 78")).toBe("0612345678");
    expect(await cleTelephone("0033 6 12 34 56 78")).toBe("0612345678");
    expect(await cleTelephone("+33 (0)6 12 34 56 78")).toBe("0612345678");
    expect(await cleTelephone("06.12.34.56.78")).toBe("0612345678");
    expect(await cleTelephone("06-12-34-56-78")).toBe("0612345678");
  });

  it("un numéro étranger reste comparable après retrait de ponctuation, sans être francisé", async () => {
    expect(await cleTelephone("+44 20 7946 0958")).toBe("+442079460958");
    expect(await cleTelephone("0044 20 7946 0958")).toBe("+442079460958");
    expect(await cleTelephone("+41 22 123 45 67")).not.toBe(await cleTelephone("0041 22 123 45 68"));
  });

  it("T. vide, « + », « 0 » ou trop court : aucune clé", async () => {
    for (const invalide of ["", "+", "0", "06 12", "+33 6", "0612345", "abc"]) {
      expect(await cleTelephone(invalide), invalide).toBeNull();
    }
    // Un `+` qui n'est pas en tête n'est pas un indicatif.
    expect(await cleTelephone("06 12+34 56 78")).toBe("0612345678");
  });
});

describe("normalisation nom + prénom (corroboration uniquement)", () => {
  it("accents, casse, tirets et apostrophes neutralisés ; les deux parties sont requises", () => {
    expect(cleNomPrenom("D'Arc", "Jean-Pierre")).toBe("jean pierre d arc");
    expect(cleNomPrenom(" DARC ", "jean pierre")).toBe("jean pierre darc");
    expect(cleNomPrenom("Émilie", "Zoé")).toBe("zoe emilie");
    expect(cleNomPrenom("Martin", undefined)).toBeUndefined();
    expect(cleNomPrenom("Martin", "  ")).toBeUndefined();
  });
});

describe("trouverContactsSimilaires — déclencheurs", () => {
  it("A. même email à casse différente : candidat, signal email", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Casse`, email: email.toLowerCase() });
    const b = await unContact({ nom: `${M} Casse bis`, email: email.toUpperCase() });
    const resultat = await similaires(a.id);
    expect(resultat?.map((c) => c.contactId)).toEqual([b.id]);
    expect(resultat?.[0].signaux).toEqual(["email"]);
  });

  it("B. même email avec espaces autour : candidat", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Trim`, email });
    const b = await unContact({ nom: `${M} Trim bis`, email: `  ${email} ` });
    expect((await similaires(a.id))?.map((c) => c.contactId)).toEqual([b.id]);
  });

  it("C. même téléphone à l'identique : candidat, signal telephone", async () => {
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} Tel`, telephone });
    const b = await unContact({ nom: `${M} Tel bis`, telephone });
    const resultat = await similaires(a.id);
    expect(resultat?.map((c) => c.contactId)).toEqual([b.id]);
    expect(resultat?.[0].signaux).toEqual(["telephone"]);
  });

  it("D/E. 06 vs +33 vs 0033 : même téléphone", async () => {
    const national = unTelephone();
    const sansZero = national.slice(1);
    const a = await unContact({ nom: `${M} FR`, telephone: `${national.slice(0, 2)} ${national.slice(2, 4)} ${national.slice(4, 6)} ${national.slice(6, 8)} ${national.slice(8)}` });
    const b = await unContact({ nom: `${M} FR plus`, telephone: `+33 ${sansZero}` });
    const c = await unContact({ nom: `${M} FR zeros`, telephone: `0033 ${sansZero}` });
    const ids = (await similaires(a.id))?.map((r) => r.contactId).sort();
    expect(ids).toEqual([b.id, c.id].sort());
    for (const r of (await similaires(a.id)) ?? []) expect(r.signaux).toEqual(["telephone"]);
  });

  it("F. email + téléphone : deux signaux forts, dans cet ordre", async () => {
    const email = unEmail();
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} Deux`, email, telephone });
    const b = await unContact({ nom: `${M} Deux bis`, email, telephone });
    const resultat = await similaires(a.id);
    expect(resultat?.[0].contactId).toBe(b.id);
    expect(resultat?.[0].signaux).toEqual(["email", "telephone"]);
  });

  it("G. nom + prénom identiques corroborent un signal fort", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Corrobore`, prenom: "Jean-Pierre", email });
    const b = await unContact({ nom: `${M} CORROBORE`, prenom: "jean pierre", email });
    const resultat = await similaires(a.id);
    expect(resultat?.[0].contactId).toBe(b.id);
    expect(resultat?.[0].signaux).toEqual(["email", "nom_prenom"]);
  });

  it("H. même nom + prénom, coordonnées distinctes : AUCUN candidat", async () => {
    const a = await unContact({ nom: `${M} Homonyme`, prenom: "Jean", email: unEmail(), telephone: unTelephone() });
    await unContact({ nom: `${M} Homonyme`, prenom: "Jean", email: unEmail(), telephone: unTelephone() });
    expect(await similaires(a.id)).toEqual([]);
  });

  it("I. contact sans email ni téléphone : [] même avec des homonymes", async () => {
    const a = await unContact({ nom: `${M} Vide`, prenom: "Marie" });
    await unContact({ nom: `${M} Vide`, prenom: "Marie" });
    await unContact({ nom: `${M} Vide`, prenom: "Marie", email: unEmail() });
    expect(await similaires(a.id)).toEqual([]);
  });

  it("J. email NULL des deux côtés n'est jamais un signal", async () => {
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} NullEmail`, telephone });
    const b = await unContact({ nom: `${M} NullEmail bis`, telephone });
    const resultat = await similaires(a.id);
    expect(resultat?.map((c) => c.contactId)).toEqual([b.id]);
    expect(resultat?.[0].signaux).toEqual(["telephone"]);
  });

  it("K. téléphone NULL des deux côtés n'est jamais un signal", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} NullTel`, email });
    const b = await unContact({ nom: `${M} NullTel bis`, email });
    expect((await similaires(a.id))?.[0]).toMatchObject({ contactId: b.id, signaux: ["email"] });
  });

  it("T. un téléphone trop court ne rapproche personne", async () => {
    const a = await unContact({ nom: `${M} Court`, telephone: "06 12" });
    await unContact({ nom: `${M} Court bis`, telephone: "06 12" });
    expect(await similaires(a.id)).toEqual([]);
  });
});

describe("trouverContactsSimilaires — périmètre", () => {
  it("L. un contact d'un autre workspace est exclu, même avec le même email", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre similarité" });
    idsWorkspaces.push(autre);
    const email = unEmail();
    const a = await unContact({ nom: `${M} Isolation`, email });
    await unContact({ nom: `${M} Isolation ailleurs`, email }, autre);
    expect(await similaires(a.id)).toEqual([]);
  });

  it("M. le contact source n'est jamais son propre candidat", async () => {
    const a = await unContact({ nom: `${M} Seul`, email: unEmail(), telephone: unTelephone() });
    expect(await similaires(a.id)).toEqual([]);
  });

  it("source introuvable : id invalide, inconnu ou d'un autre workspace → undefined, sans distinction", async () => {
    const autre = `${M}-ws2`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre similarité 2" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact({ nom: `${M} Ailleurs`, email: unEmail() }, autre);

    expect(await similaires("pas-un-uuid")).toBeUndefined();
    expect(await similaires("00000000-0000-4000-8000-000000000000")).toBeUndefined();
    expect(await similaires(ailleurs.id)).toBeUndefined();
    expect(await similaires(ailleurs.id, autre)).toEqual([]);
  });
});

describe("trouverContactsSimilaires — résultat", () => {
  it("N. trois contacts sur le même email : chacun voit les deux autres, jamais un groupe", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Partage A`, email });
    const b = await unContact({ nom: `${M} Partage B`, email });
    const c = await unContact({ nom: `${M} Partage C`, email });
    expect((await similaires(a.id))?.map((r) => r.contactId)).toEqual([b.id, c.id]);
    expect((await similaires(b.id))?.map((r) => r.contactId)).toEqual([a.id, c.id]);
  });

  it("O/P. rôles dérivés de parties_projet et nombre de projets distincts", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Roles`, email });
    const b = await unContact({ nom: `${M} Roles bis`, email });
    await unProjetAcquereur(b.id);
    await unProjetAcquereur(b.id);
    await unProjetVendeur(b.id);
    const [candidat] = (await similaires(a.id)) ?? [];
    expect(candidat).toMatchObject({ contactId: b.id, roles: ["acquereur", "vendeur"], nbProjets: 3 });
  });

  it("un candidat sans participation a des rôles vides et zéro projet", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} SansRole`, email });
    const b = await unContact({ nom: `${M} SansRole bis`, email });
    expect((await similaires(a.id))?.[0]).toMatchObject({ contactId: b.id, roles: [], nbProjets: 0 });
  });

  it("Q. au plus LIMITE_CANDIDATS candidats", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Limite`, email });
    for (let i = 0; i < LIMITE_CANDIDATS + 2; i++) await unContact({ nom: `${M} Limite ${i}`, email });
    expect(LIMITE_CANDIDATS).toBe(10);
    expect((await similaires(a.id))?.length).toBe(LIMITE_CANDIDATS);
  });

  it("R. ordre déterministe : signaux forts décroissants, puis nom, puis id", async () => {
    const email = unEmail();
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} Ordre`, email, telephone });
    const emailSeul = await unContact({ nom: `${M} Ordre A`, email });
    const lesDeux = await unContact({ nom: `${M} Ordre Z`, email, telephone });
    const telSeul = await unContact({ nom: `${M} Ordre B`, telephone });
    const ids = (await similaires(a.id))?.map((r) => r.contactId);
    expect(ids).toEqual([lesDeux.id, emailSeul.id, telSeul.id]);
  });

  it("aucun score : seuls les signaux vrais sont exposés", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Faits`, email });
    await unContact({ nom: `${M} Faits bis`, email });
    const [candidat] = (await similaires(a.id)) ?? [];
    expect(Object.keys(candidat).sort()).toEqual(
      ["contactId", "email", "nbProjets", "nom", "prenom", "roles", "signaux", "telephone"].sort()
    );
  });

  it("S. aucune écriture : les contacts sont identiques avant et après", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Lecture`, email: `  ${email.toUpperCase()} `, telephone: "+33 6 99 88 77 66" });
    const b = await unContact({ nom: `${M} Lecture bis`, email });
    const avant = await getDb().select().from(contactsTable).where(inArray(contactsTable.id, [a.id, b.id]));
    await similaires(a.id);
    await similaires(b.id);
    const apres = await getDb().select().from(contactsTable).where(inArray(contactsTable.id, [a.id, b.id]));
    expect(apres).toEqual(avant);
    // La valeur stockée n'a pas été normalisée.
    expect(apres.find((l) => l.id === a.id)?.email).toBe(`  ${email.toUpperCase()} `);
  });
});
