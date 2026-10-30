import { NextResponse } from "next/server";
import { verifierDependancesSante, type EtatDependance } from "@/lib/sante/dependancesSante";

// PILOT_PRODUCTION_HARDENING_V1 — sonde de disponibilité, et RIEN d'autre.
//
// Raison d'être : pendant le pilote, personne ne regarde les logs Railway. Sans cette route, un
// volume détaché, une base injoignable ou une variable perdue au redéploiement ne se découvrent
// qu'au moment où le conseiller téléphone. Elle existe pour qu'une sonde externe constate la panne
// avant lui.
//
// PUBLIQUE, délibérément, et c'est ce qui dicte son contenu. Une sonde n'a ni cookie de session ni
// moyen simple d'envoyer un en-tête : exiger un secret la rendrait inutilisable par le healthcheck
// natif de la plateforme. En échange, cette route ne divulgue QUE trois états — pas de chemin de
// volume, pas de nom de base, pas de message d'erreur système, pas de version, pas de compteur
// métier. Cette réduction est faite en amont par `verifierDependancesSante`, qui journalise les
// erreurs réelles côté serveur et n'en rend qu'un `UP`/`DOWN` : la route n'a donc jamais accès à un
// détail qu'elle pourrait laisser fuir.
//
// Les vérifications vivent dans `src/lib/sante/` et non ici : ADR-007, seuls les modules de
// `src/lib` parlent à Postgres. Une première version de cette route importait `getDb` directement
// et la garde structurelle du dépôt l'a refusée, à juste titre.
//
// Classification proxy : `CHEMINS_SANTE` (src/proxy.ts) — une cinquième catégorie, parce qu'aucune
// des quatre existantes ne la décrit honnêtement. Ce n'est pas un `CHEMIN_PUBLIC` (ceux-là
// permettent d'OBTENIR une session, celui-ci n'en établit aucune) ni un `CHEMIN_TECHNIQUE` (ceux-là
// ont un secret Bearer, celui-ci n'en a pas). Classifiée `ROUTES_SANTE` dans la garde structurelle
// des Route Handlers (src/db/frontiereWorkspace.structurel.test.ts).
//
// Jamais de cache : une sonde doit observer l'état de CETTE instance MAINTENANT. Même convention
// que les surfaces métier qui touchent Postgres (voir app/automatisations/page.tsx), et même motif
// — `next build` ne doit pas tenter de pré-rendre en interrogeant une base joignable seulement au
// runtime.
//
// Valable avec la configuration actuelle : Next 16 RETIRE `dynamic` lorsque Cache Components est
// activé (`cacheComponents` dans next.config.ts — absent aujourd'hui). Le jour où il le serait,
// cet export disparaîtrait ; la propriété « jamais servi depuis un cache » reposerait alors sur
// l'en-tête `Cache-Control: no-store` ci-dessous et sur l'accès à des données de runtime, pas sur
// cette ligne. À revoir à ce moment-là, jamais à supposer équivalent.
export const dynamic = "force-dynamic";

type ReponseSante = {
  application: "UP";
  database: EtatDependance;
  documentStorage: EtatDependance;
};

// Les deux dépendances sont NÉCESSAIRES au fonctionnement pilote, donc chacune suffit à faire
// échouer la sonde : sans base il n'y a pas de produit, et sans volume tout le parcours
// documentaire (dépôt, pack notaire, bon de visite signé, photos) est hors service. Un 200 partiel
// laisserait croire que tout va bien.
//
// `application: "UP"` est une tautologie assumée, et utile : si ce corps est rendu, le processus
// répond — ce qu'un 502 de la plateforme ne permettrait pas de distinguer d'une dépendance tombée.
export async function GET(): Promise<NextResponse<ReponseSante>> {
  const { database, documentStorage } = await verifierDependancesSante();

  const corps: ReponseSante = { application: "UP", database, documentStorage };
  const toutDisponible = database === "UP" && documentStorage === "UP";

  return NextResponse.json(corps, {
    status: toutDisponible ? 200 : 503,
    // Ceinture et bretelles côté intermédiaires (proxy de plateforme, CDN) : une réponse de santé
    // mise en cache est pire qu'aucune réponse, elle ferait croire une instance saine après sa
    // panne.
    headers: { "Cache-Control": "no-store" },
  });
}
