import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { verifierDisponibiliteStockageDocuments } from "@/lib/stockageDocuments";

// PILOT_PRODUCTION_HARDENING_V1 — vérification des dépendances nécessaires au fonctionnement
// pilote, pour la sonde `GET /api/health`.
//
// Pourquoi ici et pas dans la route : ADR-007 — seuls les modules de `src/lib` parlent à Postgres,
// jamais un fichier de `src/app`. La règle est verrouillée structurellement
// (src/db/mandatCanonique.structurel.test.ts interdit `from "@/db/"` depuis un écran) et elle a
// correctement rattrapé une première version de cette sonde qui importait `getDb` directement.
// La route se contente donc de traduire ce verdict en statut HTTP.
//
// Ce module ne renvoie JAMAIS de message d'erreur : les erreurs réelles portent le chemin du volume
// (`ErreurStockageDocumentsIndisponible`) ou l'hôte de la base, et la réponse de la sonde est
// publique. Elles sont journalisées côté serveur, où elles servent au diagnostic, et réduites ici à
// `UP`/`DOWN`. C'est la réduction d'information qui rend la route publiable, pas le Proxy.

export type EtatDependance = "UP" | "DOWN";

export type VerdictSante = {
  database: EtatDependance;
  documentStorage: EtatDependance;
};

// Vérification MINIMALE et non métier : prouve qu'une connexion est obtenue et qu'un aller-retour
// SQL aboutit. Jamais un `count(*)` sur une table du produit — ce serait lire de la donnée métier
// pour répondre à une question d'infrastructure, et le coût grandirait avec le portefeuille du
// conseiller.
export async function verifierDatabase(): Promise<EtatDependance> {
  try {
    await getDb().execute(sql`select 1`);
    return "UP";
  } catch (erreur) {
    console.error("[health] base de données indisponible :", erreur);
    return "DOWN";
  }
}

// Non destructive par construction : `verifierDisponibiliteStockageDocuments` fait `stat` +
// `access(W_OK)` et, en production, ne crée JAMAIS la racine (ADR-050 §32 — un répertoire absent
// signifie un volume non monté, le créer masquerait l'incident). Aucun fichier n'est écrit, lu ni
// supprimé.
//
// `ecriture: true` est le bon niveau d'exigence pour un pilote : un volume seulement lisible
// laisserait échouer tout dépôt de document, et une sonde qui dirait UP dans ce cas mentirait.
//
// Hors production, cette même fonction crée le répertoire de repli (`mkdir -p`) : comportement
// historique du poste de développement, aucun fichier métier, et sans effet sur une instance
// déployée où la branche production s'applique.
export async function verifierStockageDocuments(): Promise<EtatDependance> {
  try {
    await verifierDisponibiliteStockageDocuments({ ecriture: true });
    return "UP";
  } catch (erreur) {
    console.error("[health] stockage documentaire indisponible :", erreur);
    return "DOWN";
  }
}

// Les deux sondes sont évaluées en parallèle et AUCUNE ne court-circuite l'autre : une base tombée
// ne doit pas masquer un volume détaché, sinon on répare une panne pour en découvrir une seconde au
// redéploiement suivant.
export async function verifierDependancesSante(): Promise<VerdictSante> {
  const [database, documentStorage] = await Promise.all([verifierDatabase(), verifierStockageDocuments()]);
  return { database, documentStorage };
}
