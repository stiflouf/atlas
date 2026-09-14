import type { NouveauContact } from "@/lib/contactRepository";

// ADR-057 — LA FRONTIÈRE du formulaire d'identité canonique, et le seul endroit où une chaîne vide
// a le droit d'exister. Un input HTML vide arrive en `""` ; les colonnes optionnelles de `contacts`
// sont nullables et doivent recevoir une ABSENCE (`undefined`), jamais `""` — écrire une chaîne vide
// déguiserait un champ non renseigné en valeur (même règle que modifierAcquereurAction).
//
// Validation serveur minimale, même principe que prospectVendeurFormulaire : `nom` obligatoire
// (`contacts.nom` est NOT NULL), tout le reste optionnel, trim partout. Aucune normalisation
// d'email ou de téléphone : elle n'existe nulle part ailleurs dans le produit, et l'introduire ici
// créerait une seconde règle de forme pour la même donnée.

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

export function parseContactFormData(formData: FormData): NouveauContact {
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom est obligatoire.");

  return {
    nom,
    prenom: parseTexteOptionnel(formData.get("prenom")),
    email: parseTexteOptionnel(formData.get("email")),
    telephone: parseTexteOptionnel(formData.get("telephone")),
  };
}

// Une soumission à l'identique n'est pas une correction : rien à écrire, rien à verrouiller.
export function identiteIdentique(
  actuel: { nom: string; prenom?: string; email?: string; telephone?: string },
  saisie: NouveauContact
): boolean {
  return (
    actuel.nom === saisie.nom &&
    actuel.prenom === saisie.prenom &&
    actuel.email === saisie.email &&
    actuel.telephone === saisie.telephone
  );
}
