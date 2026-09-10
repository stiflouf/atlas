import { getDb } from "@/db/client";
import { getProjetAcquereurById, modifierChampProjetAcquereur } from "@/lib/projetAcquereurRepository";
import type { CibleCanonique, SourceDeVerite } from "@/types/provenance";
import type {
  ChampSynchronisableProjetAcquereur,
  MutationExterneNormalisee,
  ResultatApplicationMutation,
} from "@/types/synchronisation";
import { champEstVerrouille } from "./champVerrouilleRepository";
import { peutImporterVersDomiora, type DescripteurConnecteur } from "./contratConnecteur";
import { deciderApplicationValeurExterne } from "./decisionImport";
import { resoudreEntiteCanonique } from "./referenceExterneRepository";

// ADR-056 §9 — le PIPELINE du Sync Engine, sur UNE mutation. C'est la seule chose que ce lot
// construit : ni batch, ni ordonnanceur, ni connecteur.
//
//   Connecteur ──(normalisation)──> MutationExterneNormalisee ──> [ici] ──> Core
//
// Le connecteur ne touche JAMAIS le Core directement : il produit une mutation normalisée, et ce
// pipeline est le seul chemin par lequel une donnée externe peut devenir une donnée DOMIORA.
//
// Ordre des étapes, et il est délibéré — chacune peut refuser AVANT que la suivante ne coûte quoi
// que ce soit, et surtout avant toute écriture :
//   1. capacité déclarée du connecteur   (l'omission vaut refus, ADR-056 invariant 6)
//   2. type de la valeur                 (Postgres n'est pas le premier validateur)
//   3. résolution d'identité             (uniquement via `references_externes`)
//   4. type de l'entité résolue          (aucune conversion automatique)
//   5. valeur canonique actuelle
//   6. verrou humain
//   7. décision                          (`deciderApplicationValeurExterne`, seule source de vérité)
//   8. écriture, uniquement sur `appliquer`
//
// Aucun de ces refus n'est une exception : ce sont des issues normales, et les lever ferait perdre
// à l'appelant l'information qui les distingue.

// Validation de TYPE, pas de valeur métier : le pipeline vérifie que la source parle bien le type
// du champ canonique. Il ne CONVERTIT rien — « 450 000 € » doit déjà être `450000` en arrivant,
// c'est le travail de l'adaptateur du connecteur (ADR-056 §8).
//
// `null` est accepté là où le champ canonique est optionnel : c'est une information (« ce critère
// n'est pas documenté »), distincte d'un champ absent du payload, qui ne produit aucune mutation.
function valeurValidePourChamp(champ: ChampSynchronisableProjetAcquereur, valeur: unknown): string | undefined {
  const estEntierPositif = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

  switch (champ) {
    case "budgetMin":
    case "budgetMax":
      return estEntierPositif(valeur) ? undefined : "un budget est un entier positif";
    case "piecesMin":
      return valeur === null || estEntierPositif(valeur) ? undefined : "un nombre de pièces est un entier positif ou null";
    case "surfaceMin":
      return valeur === null || (typeof valeur === "number" && Number.isFinite(valeur) && valeur > 0)
        ? undefined
        : "une surface est un nombre strictement positif ou null";
    case "accessibiliteRequise":
    case "necessiteParking":
    case "necessiteExterieur":
      return valeur === null || typeof valeur === "boolean" ? undefined : "ce critère est un booléen ou null";
    case "criteres":
      return Array.isArray(valeur) && valeur.every((element) => typeof element === "string")
        ? undefined
        : "les critères sont une liste de chaînes";
    default: {
      const jamais: never = champ;
      return `champ non géré : ${String(jamais)}`;
    }
  }
}

// Traduction des DEUX représentations avant comparaison. `deciderApplicationValeurExterne()` reste
// volontairement stricte et sans coercition ; c'est ici, au contact des deux mondes, que la
// traduction a lieu — et nulle part ailleurs.
//
// Deux écarts de représentation, tous deux réels :
//   - le Core rend `undefined` pour une colonne NULL (convention de tous les repositories), une
//     source propose `null` : les deux disent « pas de valeur ». Les distinguer ferait réécrire
//     NULL par-dessus NULL à chaque pull, et aucun replay ne serait idempotent ;
//   - `['jardin']` et `['jardin']` sont deux tableaux distincts en mémoire et le même contenu.
function normaliserPourComparaison(valeur: unknown): unknown {
  if (valeur === undefined || valeur === null) return null;
  return Array.isArray(valeur) ? JSON.stringify(valeur) : valeur;
}

export type ContexteApplicationMutation = {
  // Le connecteur qui propose, avec ses capacités DÉCLARÉES. Le pipeline ne les devine jamais :
  // « telle source est forcément maître » est exactement l'inférence qu'ADR-056 interdit.
  connecteur: DescripteurConnecteur;
  // Déclarée par (entité, fournisseur), jamais globale (ADR-056 §5).
  sourceDeVerite: SourceDeVerite;
};

export async function appliquerMutationExterne(
  mutation: MutationExterneNormalisee,
  contexte: ContexteApplicationMutation,
  // ADR-054 — le périmètre vient de l'appelant, jamais d'un littéral.
  workspaceId: string
): Promise<ResultatApplicationMutation> {
  // 1. CAPACITÉ. Vérifiée en premier, et hors transaction : un connecteur qui n'a pas déclaré
  //    pouvoir importer ce type d'entité ne doit même pas provoquer une lecture.
  if (!peutImporterVersDomiora(contexte.connecteur, mutation.typeEntiteCanonique)) {
    return {
      statut: "capacite_refusee",
      fournisseur: mutation.fournisseur,
      typeEntiteCanonique: mutation.typeEntiteCanonique,
      raison: "le connecteur n'a pas déclaré pouvoir importer ce type d'entité (l'omission vaut refus)",
    };
  }

  // 2. TYPE de la valeur.
  const invalidite = valeurValidePourChamp(mutation.champ, mutation.valeurExterne);
  if (invalidite) {
    return { statut: "mutation_invalide", champ: mutation.champ, valeurExterne: mutation.valeurExterne, raison: invalidite };
  }

  // TOUT le reste dans UNE transaction : résoudre, lire le verrou, lire la valeur, décider, écrire.
  // Lire le verrou avant la transaction reviendrait à écrire sur la foi d'un état périmé.
  return getDb().transaction(async (tx) => {
    // 3. IDENTITÉ. Uniquement via `references_externes` — jamais un rapprochement par email,
    //    téléphone ou nom (ADR-056 §3, ADR-055 §H). Une identité inconnue ne crée RIEN : décider
    //    qu'un inconnu mérite une fiche est un geste d'import, avec ses propres règles.
    const identite = {
      fournisseur: mutation.fournisseur,
      typeEntiteExterne: mutation.typeEntiteExterne,
      idExterne: mutation.idExterne,
    };
    const cible = await resoudreEntiteCanonique(identite, workspaceId, tx);
    if (!cible) return { statut: "identite_inconnue", ...identite } as const;

    // 4. TYPE de l'entité résolue. Aucune conversion automatique : une référence qui pointe vers un
    //    contact ne devient pas un projet acquéreur parce que la mutation en attendait un.
    if (cible.type !== mutation.typeEntiteCanonique) {
      return { statut: "cible_inattendue", cible, typeAttendu: mutation.typeEntiteCanonique } as const;
    }

    // 5. VALEUR ACTUELLE, lue par le repository du Core — le Sync Engine connaît les contrats du
    //    Core, jamais ses tables (ADR-056 §9).
    const projet = await getProjetAcquereurById(cible.id, tx);
    if (!projet) {
      // Une référence externe pointe vers une entité disparue : la base l'interdit par sa FK, donc
      // y arriver signifierait une incohérence, pas un cas métier.
      throw new Error(`Entité canonique référencée mais introuvable : ${cible.type} ${cible.id}`);
    }
    const valeurLocale = projet[mutation.champ];

    // 6. VERROU humain, lu dans la même transaction.
    const champVerrouille = await champEstVerrouille(cible, mutation.champ, tx);

    // 7. DÉCISION. Une seule source de vérité : la règle n'est jamais réimplémentée ici.
    const decision = deciderApplicationValeurExterne({
      valeurLocale: normaliserPourComparaison(valeurLocale),
      valeurExterne: normaliserPourComparaison(mutation.valeurExterne),
      champVerrouille,
      sourceDeVerite: contexte.sourceDeVerite,
    });

    if (decision === "ignorer") {
      return {
        statut: "ignoree",
        cible,
        champ: mutation.champ,
        valeurLocale,
        valeurExterne: mutation.valeurExterne,
        raison: "la valeur canonique dit déjà la même chose",
      } as const;
    }

    if (decision === "conflit") {
      // AUCUNE écriture. Le désaccord est rendu observable, jamais résolu (ADR-056 invariant 5).
      return {
        statut: "conflit",
        conflit: {
          cible,
          champ: mutation.champ,
          valeurLocale,
          valeurExterne: mutation.valeurExterne,
          fournisseur: mutation.fournisseur,
          typeEntiteExterne: mutation.typeEntiteExterne,
          idExterne: mutation.idExterne,
          sourceDeVerite: contexte.sourceDeVerite,
          raison: champVerrouille
            ? "ce champ a été corrigé par un humain : une synchronisation ne le réécrit jamais"
            : "DOMIORA fait foi pour cette entité : l'écart est signalé, pas appliqué",
        },
      } as const;
    }

    // 8. ÉCRITURE. Un seul champ, par un mapping explicite, en préservant tout le reste. Le verrou
    //    n'est pas posé (une écriture externe n'est pas une décision humaine) et rien d'autre n'est
    //    déclenché : aucun workflow métier ne se réveille sur un import.
    const modifie = await modifierChampProjetAcquereur(cible.id, mutation.champ, mutation.valeurExterne, tx);
    if (!modifie) {
      // Le Core a refusé : un invariant métier serait violé (`budgetMin > budgetMax`). Rien n'est
      // persisté, et surtout rien n'est « réparé » — une donnée douteuse est abandonnée entière.
      return {
        statut: "refus_metier",
        champ: mutation.champ,
        valeurExterne: mutation.valeurExterne,
        raison: "la valeur violerait un invariant du Core (budget minimum supérieur au maximum)",
      } as const;
    }

    return {
      statut: "appliquee",
      cible,
      champ: mutation.champ,
      valeurPrecedente: valeurLocale,
      valeurAppliquee: modifie[mutation.champ],
    } as const;
  });
}

// Réexporté pour que l'appelant n'ait pas à connaître deux modules pour construire un contexte.
export type { CibleCanonique };
