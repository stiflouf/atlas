import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { Tache } from "@/types/tache";
import type { Visite } from "@/types/visite";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { ResultatCompatibilite } from "@/lib/compatibilite/types";
import { listerProspectsVendeurs } from "@/lib/prospectVendeurRepository";
import { listerVisites } from "@/lib/visiteRepository";
import { listerComptesRendus } from "@/lib/compteRenduVisiteRepository";
import { listerSecteursPourAcquereurs } from "@/lib/secteurRechercheRepository";
import { evaluerCompatibilite } from "@/lib/compatibilite/evaluerCompatibilite";

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
export async function chargerContexteOpportunites(deja: {
  biens: Bien[];
  acquereurs: ProfilAcquereur[];
  tachesActives: Tache[];
}): Promise<ContexteOpportunites> {
  const [prospectsVendeurs, visites, comptesRendus, secteursParAcquereur] = await Promise.all([
    listerProspectsVendeurs(),
    listerVisites(),
    listerComptesRendus(),
    listerSecteursPourAcquereurs(deja.acquereurs.map((a) => a.id)),
  ]);

  // Croisement complet bien × acquéreur par le moteur canonique (ADR-034) — fonction pure, aucune
  // requête par paire : les secteurs sont chargés en une fois ci-dessus.
  const compatibilites = deja.biens.flatMap((bien) =>
    deja.acquereurs.map((acquereur) =>
      evaluerCompatibilite(bien, acquereur, secteursParAcquereur.get(acquereur.id) ?? [])
    )
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
