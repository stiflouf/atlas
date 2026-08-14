import { getBienById, listerBiens } from "@/lib/bienRepository";
import { getClientById, listerClients } from "@/lib/clientRepository";
import { evaluerCompatibilite } from "./evaluerCompatibilite";
import type { ResultatCompatibilite } from "./types";

// Composition minimale (ADR-034, section 13) : réutilise les repositories déjà existants — aucune
// nouvelle table, aucun nouveau repository. Les deux sens (bien -> acquéreurs, acquéreur -> biens)
// appellent obligatoirement la même evaluerCompatibilite() : un seul moteur, jamais deux
// implémentations. listerBiens()/listerClients() excluent déjà les entités archivées (ADR-012) —
// jamais réintroduites silencieusement comme candidates ici. La cible elle-même (le bien ou
// l'acquéreur dont on affiche la fiche) est résolue via getBienById()/getClientById(), qui
// résolvent aussi une entité archivée : consulter les compatibilités depuis une fiche déjà
// archivée reste possible (lecture informative), seule la liste des CANDIDATS reste filtrée.

export async function evaluerCompatibiliteBien(bienId: string): Promise<ResultatCompatibilite[]> {
  const bien = await getBienById(bienId);
  if (!bien) return [];
  const acquereurs = await listerClients();
  return acquereurs.map((acquereur) => evaluerCompatibilite(bien, acquereur));
}

export async function evaluerCompatibiliteAcquereur(acquereurId: string): Promise<ResultatCompatibilite[]> {
  const acquereur = await getClientById(acquereurId);
  if (!acquereur) return [];
  const biens = await listerBiens();
  return biens.map((bien) => evaluerCompatibilite(bien, acquereur));
}
