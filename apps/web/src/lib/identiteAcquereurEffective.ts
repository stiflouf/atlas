import { eq, inArray } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, contacts as contactsTable } from "@/db/schema";

// ADR-057 — LA RÈGLE DE SOURCE de l'identité humaine d'un acquéreur, écrite UNE SEULE FOIS.
//
//   contact_id présent  ->  le CONTACT fournit nom, prenom, email, telephone
//   contact_id absent   ->  le dossier historique les fournit
//
// Le repli est au niveau de l'AGRÉGAT D'IDENTITÉ, jamais du champ. `contact.email` à NULL veut dire
// « on ne connaît pas son adresse », pas « reprendre celle du dossier ». Reprendre le legacy champ
// à champ ressusciterait une adresse qu'un humain vient précisément d'effacer — et ferait partir un
// email à une personne qui avait demandé à ne plus en recevoir à cette adresse.
//
// Même module, même discipline que `criteresAcquereurEffectifs.ts` pour les critères : une seule
// question, une seule réponse, deux projections (affichage et écriture) qui s'y branchent.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdentiteHumaine = {
  // Seul champ obligatoire, ici comme dans `contacts` : c'est le seul que les deux modèles
  // garantissent.
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
};

// `source` n'est pas décoratif : le chemin d'ÉCRITURE en dépend pour savoir où écrire, et le lire
// plutôt que le redéduire évite une seconde interprétation du pont.
export type SourceIdentite =
  | { source: "contact"; contactId: string; identite: IdentiteHumaine }
  | { source: "dossier" };

type LigneJointe = {
  acquereurId: string;
  contactId: string | null;
  contactTrouveId: string | null;
  nom: string | null;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
};

// NULL Postgres -> undefined métier, jamais une chaîne vide : un contact sans email n'a pas
// d'email, il n'en a pas un qui serait "" (même traduction que `ligneVersContact`).
function identiteDuContact(ligne: LigneJointe): IdentiteHumaine {
  return {
    nom: ligne.nom!,
    prenom: ligne.prenom ?? undefined,
    email: ligne.email ?? undefined,
    telephone: ligne.telephone ?? undefined,
  };
}

// Une seule requête pour tout un lot, jamais une par acquéreur : ces fonctions servent des listes
// paginées et l'écran Aujourd'hui.
export async function resoudreSourcesIdentite(
  acquereurIds: string[],
  executeur: Executeur = getDb()
): Promise<Map<string, SourceIdentite>> {
  const idsPersistes = acquereurIds.filter((id) => UUID_REGEX.test(id));
  if (idsPersistes.length === 0) return new Map();

  const lignes: LigneJointe[] = await executeur
    .select({
      acquereurId: acquereursTable.id,
      contactId: acquereursTable.contactId,
      contactTrouveId: contactsTable.id,
      nom: contactsTable.nom,
      prenom: contactsTable.prenom,
      email: contactsTable.email,
      telephone: contactsTable.telephone,
    })
    .from(acquereursTable)
    .leftJoin(contactsTable, eq(acquereursTable.contactId, contactsTable.id))
    .where(inArray(acquereursTable.id, idsPersistes));

  return new Map(
    lignes.map((ligne) => {
      // FAIL CLOSED. La FK `acquereurs.contact_id -> contacts.id` rend ce cas impossible ; y
      // arriver signifie une incohérence de données, jamais un cas métier. Retomber silencieusement
      // sur le dossier afficherait une identité périmée en la présentant comme canonique, et
      // enverrait les emails à l'ancienne adresse sans que rien ne le signale.
      if (ligne.contactId !== null && ligne.contactTrouveId === null) {
        throw new Error(
          `Contact référencé mais introuvable : acquereur ${ligne.acquereurId} -> contact ${ligne.contactId}`
        );
      }
      const source: SourceIdentite =
        ligne.contactTrouveId === null
          ? { source: "dossier" }
          : { source: "contact", contactId: ligne.contactTrouveId, identite: identiteDuContact(ligne) };
      return [ligne.acquereurId, source];
    })
  );
}

export async function resoudreSourceIdentite(
  acquereurId: string,
  executeur: Executeur = getDb()
): Promise<SourceIdentite> {
  // Absence de ligne : acquéreur non persisté (jeu de démonstration servi avant toute création
  // réelle, ids non-UUID) ou disparu entre deux lectures. Dans les deux cas le dossier en mémoire
  // est la seule donnée qui existe — exactement le comportement d'avant la bascule.
  return (await resoudreSourcesIdentite([acquereurId], executeur)).get(acquereurId) ?? { source: "dossier" };
}
