import type { AvertissementFusionContact } from "@/types/contactFusion";

// ADR-059 — ANALYSE pure d'une fusion, partagée entre le moteur (qui la recalcule SOUS VERROU et
// fait foi) et le read model de préparation (qui la montre à l'humain avant qu'il ne décide).
// Une seule définition de « contradiction » : ce que l'écran annonce est exactement ce que le
// moteur exigera de voir acquitté. Aucune base ici, aucune écriture : des lignes en entrée, des
// faits en sortie.

export type ReferenceExterneAnalysee = {
  contactId: string | null;
  fournisseur: string;
  typeEntiteExterne: string;
  idExterne: string;
};

// Les références du même (fournisseur, type) portées par les DEUX contacts avec des ids externes
// différents : un fournisseur qui connaît deux fiches pour une personne. Pas une erreur SQL (la clé
// d'unicité ne contient pas le contact), une contradiction que l'humain doit acquitter en
// connaissance de cause. Clé déterministe, recalculée sous verrou.
export function avertissementsReferencesExternes(
  refs: ReferenceExterneAnalysee[],
  survivantId: string,
  absorbeId: string
): AvertissementFusionContact[] {
  const groupes = new Map<string, { fournisseur: string; typeEntiteExterne: string; survivant: Set<string>; absorbe: Set<string> }>();
  for (const ref of refs) {
    const cle = `${ref.fournisseur}/${ref.typeEntiteExterne}`;
    const groupe = groupes.get(cle) ?? {
      fournisseur: ref.fournisseur,
      typeEntiteExterne: ref.typeEntiteExterne,
      survivant: new Set<string>(),
      absorbe: new Set<string>(),
    };
    if (ref.contactId === survivantId) groupe.survivant.add(ref.idExterne);
    if (ref.contactId === absorbeId) groupe.absorbe.add(ref.idExterne);
    groupes.set(cle, groupe);
  }
  return [...groupes.entries()]
    .filter(([, g]) => g.survivant.size > 0 && g.absorbe.size > 0)
    .filter(([, g]) => [...g.absorbe].some((id) => !g.survivant.has(id)))
    .map(([cle, g]) => ({
      cle: `reference_externe_contradictoire:${cle}`,
      type: "reference_externe_contradictoire" as const,
      fournisseur: g.fournisseur,
      typeEntiteExterne: g.typeEntiteExterne,
      idsExternesSurvivant: [...g.survivant].sort(),
      idsExternesAbsorbe: [...g.absorbe].sort(),
    }))
    .sort((a, b) => a.cle.localeCompare(b.cle));
}
