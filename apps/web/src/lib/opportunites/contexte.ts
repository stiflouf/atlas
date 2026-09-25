import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { Tache } from "@/types/tache";
import type { Visite } from "@/types/visite";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { ResultatCompatibilite } from "@/lib/compatibilite/types";
import { listerProspectsVendeursDuWorkspace } from "@/lib/prospectVendeurRepository";
import { listerVisitesDuWorkspace } from "@/lib/visiteRepository";
import { listerComptesRendusDuWorkspace } from "@/lib/compteRenduVisiteRepository";
import { listerSecteursPourAcquereurs } from "@/lib/secteurRechercheRepository";
import { evaluerCompatibilite } from "@/lib/compatibilite/evaluerCompatibilite";
import { resoudreProfilsCompatibilite } from "@/lib/compatibilite/profilCompatibiliteRepository";

// Faits structurés consommés par detecterOpportunites(). Aucune requête Drizzle n'est écrite ici
// ni dans les règles : même séparation repository/domaine que chargerContexteAlertes() (ADR-026)
// et que les moteurs de compatibilité et de checklist.
//
// `compatibilites` est déjà le résultat du moteur canonique (ADR-034), jamais recalculé autrement :
// les règles de match lisent son verdict et ses critères, elles n'en réimplémentent aucun.
export type ContexteOpportunites = {
  biens: Bien[];
  acquereurs: ProfilAcquereur[];
  prospectsVendeurs: ProspectVendeur[];
  visites: Visite[];
  comptesRendus: CompteRenduVisite[];
  compatibilites: ResultatCompatibilite[];
  // Uniquement les tâches ACTIVES : ce sont elles, et elles seules, qui peuvent absorber une
  // opportunité équivalente (voir deduplication.ts). Une tâche terminée ou annulée n'absorbe rien.
  tachesActives: Tache[];
};

// Assemblage du contexte — seul point d'accès aux repositories pour ce moteur, exactement comme
// chargerContexteAlertes() (ADR-026). `deja` reçoit les collections que l'écran Aujourd'hui a déjà
// chargées pour ses autres sections : les relire ici doublerait trois requêtes sans rien apporter.
// WORKSPACE_SCOPING_V2B2 (ADR-054) — le croisement ci-dessous est un produit cartésien
// bien × acquéreur : si l'une des deux collections franchit la frontière, le moteur FABRIQUE des
// opportunités inter-workspaces — un bien d'ici proposé à une personne d'ailleurs, nommément.
// Deux conditions, et les deux sont nécessaires : les collections `deja` doivent être scopées par
// l'appelant (elles le sont depuis V2B1/V2B2), et les trois lectures faites ICI doivent l'être
// aussi. Filtrer le résultat final ne suffirait pas : les paires auraient déjà existé.
export async function chargerContexteOpportunites(
  deja: {
    biens: Bien[];
    acquereurs: ProfilAcquereur[];
    tachesActives: Tache[];
  },
  workspaceId: string
): Promise<ContexteOpportunites> {
  const [prospectsVendeurs, visites, comptesRendus, secteursParAcquereur, profils] = await Promise.all([
    listerProspectsVendeursDuWorkspace(workspaceId),
    listerVisitesDuWorkspace(workspaceId),
    listerComptesRendusDuWorkspace(workspaceId),
    listerSecteursPourAcquereurs(deja.acquereurs.map((a) => a.id)),
    // ADR-055 §B — critères effectifs : projet acquéreur canonique dès que le dossier est rattaché,
    // dossier historique sinon, résolus en une requête pour toute la liste. `acquereurs` reste
    // exposé tel quel dans le contexte : les règles d'opportunité s'en servent pour nommer et
    // joindre une personne, jamais pour rejuger une compatibilité — c'est `compatibilites` qui
    // porte ce verdict, et il ne doit pas exister deux réponses à la même question dans un contexte.
    resoudreProfilsCompatibilite(deja.acquereurs),
  ]);

  // Croisement complet bien × acquéreur par le moteur canonique (ADR-034) — fonction pure, aucune
  // requête par paire : les secteurs sont chargés en une fois ci-dessus.
  const compatibilites = deja.biens.flatMap((bien) =>
    profils.map((profil) => evaluerCompatibilite(bien, profil, secteursParAcquereur.get(profil.id) ?? []))
  );

  return {
    biens: deja.biens,
    acquereurs: deja.acquereurs,
    prospectsVendeurs,
    visites,
    comptesRendus,
    compatibilites,
    tachesActives: deja.tachesActives,
  };
}
