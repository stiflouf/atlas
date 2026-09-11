import { getDb, type Executeur } from "@/db/client";
import { resoudreSourcesCriteres } from "@/lib/criteresAcquereurEffectifs";
import type { ProfilAcquereur } from "@/types/client";
import type { ProfilCompatibiliteAcquereur } from "@/types/profilCompatibiliteAcquereur";

// ADR-055 §B — PROJECTION vers le contrat d'entrée du moteur. La RÈGLE de source (projet canonique
// quand le dossier est rattaché, dossier historique sinon, au niveau de l'agrégat) vit dans
// `lib/criteresAcquereurEffectifs.ts` et n'est pas réécrite ici : l'affichage et le matching
// répondent à la même question, et deux implémentations finiraient par y répondre différemment.
//
// Ce que ce module ajoute, et qui lui appartient : ne retenir que ce que le MOTEUR lit. `budgetMin`
// (aucune sémantique de compatibilité, ADR-034), `criteres` (texte libre, ADR-008) et toute
// identité humaine s'arrêtent ici — le moteur ne doit pas pouvoir les atteindre.
//
// Les SECTEURS DE RECHERCHE (ADR-035) restent une table enfant de `acquereurs`, chargée par l'id du
// dossier et passée au moteur par les appelants : le modèle de lecture effectif est HYBRIDE et
// assumé, jusqu'au lot qui canonicalisera ces enfants.

function profilDuDossier(acquereur: ProfilAcquereur): ProfilCompatibiliteAcquereur {
  return {
    id: acquereur.id,
    budgetMax: acquereur.budgetMax,
    piecesMin: acquereur.piecesMin,
    surfaceMin: acquereur.surfaceMin,
    accessibiliteRequise: acquereur.accessibiliteRequise,
    necessiteParking: acquereur.necessiteParking,
    necessiteExterieur: acquereur.necessiteExterieur,
  };
}

// Ordre d'entrée préservé : les appelants alignent le résultat sur leur propre liste d'acquéreurs.
export async function resoudreProfilsCompatibilite(
  acquereurs: ProfilAcquereur[],
  executeur: Executeur = getDb()
): Promise<ProfilCompatibiliteAcquereur[]> {
  const sources = await resoudreSourcesCriteres(
    acquereurs.map((a) => a.id),
    executeur
  );
  return acquereurs.map((acquereur) => {
    const source = sources.get(acquereur.id);
    if (!source || source.source === "dossier") return profilDuDossier(acquereur);
    const { criteres } = source;
    return {
      // TOUJOURS l'id du DOSSIER, jamais celui du projet : c'est lui que porte
      // `ResultatCompatibilite.acquereurId`, que `compatibilites_bien_acquereur_etat` mémorise et
      // que `evenements_metier` référence.
      id: acquereur.id,
      budgetMax: criteres.budgetMax,
      piecesMin: criteres.piecesMin,
      surfaceMin: criteres.surfaceMin,
      accessibiliteRequise: criteres.accessibiliteRequise,
      necessiteParking: criteres.necessiteParking,
      necessiteExterieur: criteres.necessiteExterieur,
    };
  });
}

export async function resoudreProfilCompatibilite(
  acquereur: ProfilAcquereur,
  executeur: Executeur = getDb()
): Promise<ProfilCompatibiliteAcquereur> {
  const [profil] = await resoudreProfilsCompatibilite([acquereur], executeur);
  return profil;
}
