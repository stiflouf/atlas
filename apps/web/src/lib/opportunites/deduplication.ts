import { deriverCibleTache, type Tache } from "@/types/tache";
import type { Opportunite, TypeOpportunite } from "@/types/opportunite";

// VALUE-01, point critique du cahier des charges : une opportunité n'est pas une tâche. Si le
// conseiller a DÉJÀ une tâche ouverte qui couvre la même action sur la même cible, DOMIORA ne doit
// pas la lui redire une seconde fois sous un autre nom — « Relancer Hélène Vasseur » ne doit
// apparaître qu'une seule fois dans Aujourd'hui.
//
// La correspondance se fait sur la CIBLE MÉTIER (FK réelle de `taches`, ADR-028) croisée avec la
// famille d'action, jamais sur une comparaison de libellés : deux textes différents peuvent
// désigner la même action, et deux textes identiques des dossiers différents.
const CIBLE_TACHE_ABSORBANTE: Record<TypeOpportunite, ReadonlyArray<string>> = {
  // Une tâche portant ce prospect vendeur couvre déjà la relance de ce prospect.
  relance_prospect_vendeur: ["prospectVendeur"],
  // Une tâche portant la visite elle-même, ou l'acquéreur venu visiter, couvre déjà le suivi.
  suivi_visite: ["visite", "acquereur"],
  // Une tâche portant l'acquéreur couvre déjà la mise en relation avec un bien.
  match_a_exploiter: ["acquereur"],
  // Une tâche portant le bien couvre déjà la collecte de l'information manquante sur ce bien.
  information_a_verifier: ["bien"],
};

function cleTache(tache: Tache): string | undefined {
  const cible = deriverCibleTache(tache);
  return cible ? `${cible.type}:${cible.id}` : undefined;
}

// Une opportunité est absorbée si une tâche active porte l'une des cibles absorbantes de son type.
// `suivi_visite` cible la visite mais accepte aussi une tâche sur l'acquéreur concerné : c'est le
// même travail de relance côté conseiller, quelle que soit la FK qu'il a choisie en créant sa tâche.
function estCouverteParUneTache(opportunite: Opportunite, clesTaches: ReadonlySet<string>, cibleSecondaire?: string): boolean {
  const typesAbsorbants = CIBLE_TACHE_ABSORBANTE[opportunite.type];
  const candidates = [`${opportunite.cible.type}:${opportunite.cible.id}`, cibleSecondaire].filter(
    (c): c is string => typeof c === "string"
  );
  return candidates.some((cle) => {
    const [type] = cle.split(":");
    return typesAbsorbants.includes(type) && clesTaches.has(cle);
  });
}

// `ciblesSecondaires` : pour une opportunité dont la cible principale n'est pas la seule FK
// pertinente (une visite concerne aussi son acquéreur), la règle qui l'a produite fournit ici la
// seconde clé à confronter aux tâches. Jamais devinée ici.
export function dedupliquerOpportunites(
  opportunites: Opportunite[],
  tachesActives: Tache[],
  ciblesSecondaires: ReadonlyMap<string, string> = new Map()
): Opportunite[] {
  const clesTaches = new Set(tachesActives.map(cleTache).filter((c): c is string => typeof c === "string"));

  const retenues = opportunites.filter(
    (o) => !estCouverteParUneTache(o, clesTaches, ciblesSecondaires.get(o.id))
  );

  // Filet de sécurité : même id déterministe = même cause exacte, gardée une seule fois.
  const parId = new Map<string, Opportunite>();
  for (const opportunite of retenues) {
    if (!parId.has(opportunite.id)) parId.set(opportunite.id, opportunite);
  }
  return [...parId.values()];
}
