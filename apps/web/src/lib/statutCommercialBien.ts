import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";
import type { Offre } from "@/types/offre";

// Nom distinct de StatutDossier (data/dossier.ts, mock) malgré les mêmes valeurs littérales —
// même précédent que DocumentBien/DocumentDossier, pour ne jamais confondre les deux sources.
// "vendu" n'a aucun équivalent dans le mock (StatutDossier s'arrête à compromis_signe) — état
// ajouté uniquement côté réel, ADR-017. "offre_acceptee" (ADR-061 §10) : une offre canonique
// acceptée n'est plus « en cours » (la décision est prise) mais le bien n'est pas encore sous
// compromis — sans cet état, ce moment ne pouvait être rendu que faussement.
export type StatutCommercial = "en_commercialisation" | "offre_en_cours" | "offre_acceptee" | "compromis_signe" | "vendu";

export const LABEL_STATUT_COMMERCIAL: Record<StatutCommercial, string> = {
  en_commercialisation: "En commercialisation",
  offre_en_cours: "Offre en cours",
  offre_acceptee: "Offre acceptée",
  compromis_signe: "Compromis signé",
  vendu: "Vendu",
};

// ADR-061 §10-§11 — LA règle du statut commercial, écrite une seule fois, dérivée (jamais stockée,
// ADR-014) des ENTITÉS CANONIQUES d'abord :
//
//   vendu > compromis_signe > offre_acceptee > offre_en_cours > en_commercialisation
//
// Le legacy n'intervient que PAR ENTITÉ ABSENTE : `biens.compromis_signe_le` uniquement si le bien
// n'a aucun compromis canonique (ADR-046, inchangé) ; `biens.offre_en_cours_le` uniquement si le
// bien n'a AUCUNE offre canonique, quel que soit son statut. Un bien dont la seule offre est
// `refusee`, `retiree` ou `caduque` est en mode canonique Offre : il redescend à
// `en_commercialisation` (ou reste au-dessus par le compromis), jamais `offre_en_cours` par un
// vieux timestamp — présence canonique ≠ offre ouverte (CANONICAL_EXISTENCE_MODEL).
//
// `offres` = TOUTES les offres canoniques du bien (tous statuts), `compromisListe` = tous ses
// compromis : c'est leur EXISTENCE qui décide du mode, pas leur état.
export function statutCommercialBienEffectif(
  bien: Pick<Bien, "offreEnCoursLe" | "compromisSigneLe">,
  offres: Pick<Offre, "statut">[],
  compromisListe: Pick<Compromis, "statut" | "dateActeReelle">[]
): StatutCommercial {
  if (compromisListe.some((c) => c.statut === "realise" && c.dateActeReelle)) return "vendu";
  // Tout compromis structuré NON annulé fait basculer vers "compromis_signe", indépendamment du
  // jalon legacy ; si tous sont 'annule', le jalon legacy n'est JAMAIS consulté (ADR-046).
  if (compromisListe.some((c) => c.statut !== "annule")) return "compromis_signe";
  if (compromisListe.length === 0 && bien.compromisSigneLe) return "compromis_signe";
  if (offres.length > 0) {
    if (offres.some((o) => o.statut === "acceptee")) return "offre_acceptee";
    if (offres.some((o) => o.statut === "en_cours")) return "offre_en_cours";
    return "en_commercialisation";
  }
  if (bien.offreEnCoursLe) return "offre_en_cours";
  return "en_commercialisation";
}
