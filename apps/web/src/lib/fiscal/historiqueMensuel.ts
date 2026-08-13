import { chargerHistoriqueAmorcage } from "@/lib/historiqueAmorcageRepository";
import { listerEncaissementsDepuis } from "@/lib/remunerationRepository";
import { lendemain } from "@/lib/fiscal/assietteAnnuelle";

export type MoisHistorique = { mois: string; montantCentimes: number }; // mois au format "YYYY-MM"

function aujourdHuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function moisDe(dateIso: string): string {
  return dateIso.slice(0, 7);
}

function moisPrecedent(moisIso: string): string {
  const [annee, mois] = moisIso.split("-").map(Number);
  return mois === 1 ? `${annee - 1}-12` : `${annee}-${String(mois - 1).padStart(2, "0")}`;
}

function ajouterUnMois(moisIso: string): string {
  const [annee, mois] = moisIso.split("-").map(Number);
  return mois === 12 ? `${annee + 1}-01` : `${annee}-${String(mois + 1).padStart(2, "0")}`;
}

// ADR-025, correction obligatoire n° 2 : série mensuelle zero-remplie, jamais une moyenne sur les
// seuls mois ayant une vente. Un mois n'entre dans cette série QUE si sa couverture est garantie de
// bout en bout — entièrement postérieur à la dernière ligne historique_amorcage connue (toutes
// années confondues, la plus récente dateFinCouverture fait foi) ET entièrement écoulé (jamais le
// mois en cours, encore partiel). Si la frontière de couverture tombe en cours de mois, ce mois
// partiel ne compte pas — le premier mois garanti est alors le suivant. Absence totale de ligne
// historique_amorcage = aucune frontière garantie = aucun mois ne compte, quel que soit le volume de
// faits Atlas disponibles (même principe que resoudreAssietteAnnuelle, ADR-024).
export async function chargerHistoriqueMensuel(dossierFiscalId: string): Promise<MoisHistorique[]> {
  const lignesAmorcage = await chargerHistoriqueAmorcage(dossierFiscalId);
  if (lignesAmorcage.length === 0) return [];

  const derniereDateFinCouverture = lignesAmorcage
    .map((l) => l.dateFinCouverture)
    .reduce((max, date) => (date > max ? date : max));

  const lendemainCouverture = lendemain(derniereDateFinCouverture);
  const premierMoisGaranti = lendemainCouverture.endsWith("-01")
    ? moisDe(lendemainCouverture)
    : ajouterUnMois(moisDe(lendemainCouverture));

  const dernierMoisEcoule = moisPrecedent(moisDe(aujourdHuiIso()));
  if (premierMoisGaranti > dernierMoisEcoule) return [];

  const encaissements = await listerEncaissementsDepuis(`${premierMoisGaranti}-01`);
  const sommesParMois = new Map<string, number>();
  for (const e of encaissements) {
    const cle = moisDe(e.dateEncaissementReelle);
    sommesParMois.set(cle, (sommesParMois.get(cle) ?? 0) + e.montantCentimes);
  }

  const serie: MoisHistorique[] = [];
  let curseur = premierMoisGaranti;
  while (curseur <= dernierMoisEcoule) {
    serie.push({ mois: curseur, montantCentimes: sommesParMois.get(curseur) ?? 0 });
    curseur = ajouterUnMois(curseur);
  }
  return serie;
}
