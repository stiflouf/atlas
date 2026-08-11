import type { NouvelAcquereur } from "@/lib/clientRepository";
import type { StadeProjet } from "@/types/client";

// Un select à 3 états (Inconnu/Oui/Non) — jamais une checkbox — pour ne jamais pouvoir soumettre
// "false" par accident quand l'information est simplement inconnue. Partagé entre création et
// édition : le formulaire est le même, la conversion doit l'être aussi.
export function parseTriEtat(valeur: FormDataEntryValue | null): boolean | undefined {
  if (valeur === "oui") return true;
  if (valeur === "non") return false;
  return undefined;
}

export function parseNombreOptionnel(valeur: FormDataEntryValue | null): number | undefined {
  if (!valeur || String(valeur).trim() === "") return undefined;
  return Number(valeur);
}

// Validation serveur minimale : incohérences évidentes uniquement, pas de règle métier avancée.
// Utilisée à l'identique par creerAcquereurAction et modifierAcquereurAction.
export function parseAcquereurFormData(formData: FormData): NouvelAcquereur {
  const budgetMin = Number(formData.get("budgetMin"));
  const budgetMax = Number(formData.get("budgetMax"));
  const piecesMin = parseNombreOptionnel(formData.get("piecesMin"));
  const surfaceMin = parseNombreOptionnel(formData.get("surfaceMin"));

  if (!Number.isFinite(budgetMin) || budgetMin < 0) {
    throw new Error("Budget minimum invalide : doit être positif ou nul.");
  }
  if (!Number.isFinite(budgetMax) || budgetMax < 0) {
    throw new Error("Budget maximum invalide : doit être positif ou nul.");
  }
  if (budgetMin > budgetMax) {
    throw new Error("Le budget minimum ne peut pas être supérieur au budget maximum.");
  }
  if (piecesMin !== undefined && (!Number.isFinite(piecesMin) || piecesMin <= 0)) {
    throw new Error("Pièces minimum invalide : doit être strictement supérieur à 0.");
  }
  if (surfaceMin !== undefined && (!Number.isFinite(surfaceMin) || surfaceMin <= 0)) {
    throw new Error("Surface minimum invalide : doit être strictement supérieure à 0.");
  }

  const criteres = String(formData.get("criteres") ?? "")
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter(Boolean);

  return {
    prenom: String(formData.get("prenom") ?? "").trim(),
    nom: String(formData.get("nom") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    telephone: String(formData.get("telephone") ?? "").trim(),
    budgetMin,
    budgetMax,
    criteres,
    stadeProjet: String(formData.get("stadeProjet")) as StadeProjet,
    notes: String(formData.get("notes") ?? "").trim(),
    datePremiereContact: String(formData.get("datePremiereContact")),
    piecesMin,
    surfaceMin,
    accessibiliteRequise: parseTriEtat(formData.get("accessibiliteRequise")),
    necessiteParking: parseTriEtat(formData.get("necessiteParking")),
    necessiteExterieur: parseTriEtat(formData.get("necessiteExterieur")),
  };
}
