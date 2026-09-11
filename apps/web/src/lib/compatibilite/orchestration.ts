import { getBienById, listerBiens } from "@/lib/bienRepository";
import { getClientById, listerClients } from "@/lib/clientRepository";
import { listerSecteursPourAcquereur, listerSecteursPourAcquereurs } from "@/lib/secteurRechercheRepository";
import { evaluerCompatibilite } from "./evaluerCompatibilite";
import { resoudreProfilCompatibilite, resoudreProfilsCompatibilite } from "./profilCompatibiliteRepository";
import type { ResultatCompatibilite } from "./types";

// Composition minimale (ADR-034, section 13) : réutilise les repositories déjà existants — aucune
// nouvelle table, aucun nouveau repository. Les deux sens (bien -> acquéreurs, acquéreur -> biens)
// appellent obligatoirement la même evaluerCompatibilite() : un seul moteur, jamais deux
// implémentations. listerBiens()/listerClients() excluent déjà les entités archivées (ADR-012) —
// jamais réintroduites silencieusement comme candidates ici. La cible elle-même (le bien ou
// l'acquéreur dont on affiche la fiche) est résolue via getBienById()/getClientById(), qui
// résolvent aussi une entité archivée : consulter les compatibilités depuis une fiche déjà
// archivée reste possible (lecture informative), seule la liste des CANDIDATS reste filtrée.
//
// Secteurs de recherche (ADR-035) : chargés en une seule requête groupée par sens d'orchestration,
// jamais une requête par paire bien × acquéreur ni une requête par acquéreur dans la boucle
// evaluerCompatibiliteBien — voir listerSecteursPourAcquereurs (secteurRechercheRepository.ts).
//
// ADR-055 §B — les CRITÈRES passés au moteur ne sortent plus du dossier chargé ici : ils sont
// résolus par resoudreProfilsCompatibilite(), qui rend le projet canonique quand l'acquéreur en a
// un et le dossier historique sinon. Le dossier reste chargé pour ce qu'il porte encore (identité,
// archivage, id des secteurs) — jamais pour ses critères.

export async function evaluerCompatibiliteBien(bienId: string): Promise<ResultatCompatibilite[]> {
  const bien = await getBienById(bienId);
  if (!bien) return [];
  const acquereurs = await listerClients();
  const [profils, secteursParAcquereur] = await Promise.all([
    resoudreProfilsCompatibilite(acquereurs),
    listerSecteursPourAcquereurs(acquereurs.map((a) => a.id)),
  ]);
  return profils.map((profil) => evaluerCompatibilite(bien, profil, secteursParAcquereur.get(profil.id) ?? []));
}

export async function evaluerCompatibiliteAcquereur(acquereurId: string): Promise<ResultatCompatibilite[]> {
  const acquereur = await getClientById(acquereurId);
  if (!acquereur) return [];
  const [biens, secteursRecherche, profil] = await Promise.all([
    listerBiens(),
    listerSecteursPourAcquereur(acquereurId),
    resoudreProfilCompatibilite(acquereur),
  ]);
  return biens.map((bien) => evaluerCompatibilite(bien, profil, secteursRecherche));
}
