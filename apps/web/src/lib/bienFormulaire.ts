import type { NouveauBien } from "@/lib/bienRepository";
import type { TypeBien, StatutMandat, Exterieur, ChargeHonoraires } from "@/types/bien";

// Un select à 3 états (Inconnu/Oui/Non) — jamais une checkbox — pour ne jamais pouvoir soumettre
// "false" par accident quand l'information est simplement inconnue. Partagé entre création et
// édition : le formulaire est le même, la conversion doit l'être aussi.
export function parseTriEtat(valeur: FormDataEntryValue | null): boolean | undefined {
  if (valeur === "oui") return true;
  if (valeur === "non") return false;
  return undefined;
}

export function parseExterieur(valeur: FormDataEntryValue | null): Exterieur | undefined {
  if (valeur === "aucun" || valeur === "balcon" || valeur === "terrasse" || valeur === "jardin") return valeur;
  return undefined;
}

export function parseChargeHonoraires(valeur: FormDataEntryValue | null): ChargeHonoraires | undefined {
  if (valeur === "vendeur" || valeur === "acquereur") return valeur;
  return undefined;
}

// Validation serveur minimale : incohérences évidentes uniquement, pas de règle métier avancée.
// Utilisée à l'identique par creerBienAction et modifierBienAction — la validation ne doit
// jamais diverger entre création et édition.
export function parseBienFormData(formData: FormData): NouveauBien {
  const surface = Number(formData.get("surface"));
  const pieces = Number(formData.get("pieces"));
  const prix = Number(formData.get("prix"));
  const etageBrut = formData.get("etage");
  const etage = etageBrut && String(etageBrut).trim() !== "" ? Number(etageBrut) : undefined;

  if (!Number.isFinite(surface) || surface <= 0) {
    throw new Error("Surface invalide : doit être strictement supérieure à 0.");
  }
  if (!Number.isFinite(pieces) || pieces <= 0) {
    throw new Error("Nombre de pièces invalide : doit être strictement supérieur à 0.");
  }
  if (!Number.isFinite(prix) || prix < 0) {
    throw new Error("Prix invalide : doit être positif ou nul.");
  }
  if (etage !== undefined && (!Number.isFinite(etage) || etage < 0)) {
    throw new Error("Étage invalide : doit être positif ou nul.");
  }

  const caracteristiques = String(formData.get("caracteristiques") ?? "")
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter(Boolean);

  return {
    reference: String(formData.get("reference") ?? "").trim(),
    titre: String(formData.get("titre") ?? "").trim(),
    type: String(formData.get("type")) as TypeBien,
    adresse: String(formData.get("adresse") ?? "").trim(),
    ville: String(formData.get("ville") ?? "").trim(),
    codePostal: String(formData.get("codePostal") ?? "").trim(),
    surface,
    pieces,
    prix,
    statutMandat: String(formData.get("statutMandat")) as StatutMandat,
    dateMandat: String(formData.get("dateMandat")),
    caracteristiques,
    description: String(formData.get("description") ?? "").trim(),
    etage,
    ascenseur: parseTriEtat(formData.get("ascenseur")),
    parking: parseTriEtat(formData.get("parking")),
    exterieur: parseExterieur(formData.get("exterieur")),
    nomCopropriete: String(formData.get("nomCopropriete") ?? "").trim() || undefined,
    chargeHonoraires: parseChargeHonoraires(formData.get("chargeHonoraires")),
  };
}
