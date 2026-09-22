import { parseBienFormData } from "@/lib/bienFormulaire";
import { ORIGINES_LEAD } from "@/types/origineLead";
import type { NouveauBien } from "@/lib/bienRepository";
import type { NouveauProspectVendeur } from "@/types/prospectVendeur";
import type { OrigineLead } from "@/types/origineLead";
import type { TypeBien } from "@/types/bien";
import { ErreurSaisie } from "@/lib/formulaires/etatFormulaire";

const TYPES_BIEN: TypeBien[] = ["appartement", "maison", "studio", "loft", "local_commercial"];

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Validation serveur minimale, même principe que acquereurFormulaire/bienFormulaire — utilisée à
// l'identique par creerProspectVendeurAction et modifierProspectVendeurAction. Ne touche jamais
// aux jalons/issue commerciale/archivage : uniquement les champs saisissables à la création
// (voir NouveauProspectVendeur, ADR-027).
export function parseProspectVendeurFormData(formData: FormData): NouveauProspectVendeur {
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new ErreurSaisie("Le nom est obligatoire.");

  const origineLeadBrut = parseTexteOptionnel(formData.get("origineLead"));
  if (origineLeadBrut !== undefined && !ORIGINES_LEAD.includes(origineLeadBrut as OrigineLead)) {
    throw new ErreurSaisie("Origine du lead invalide.");
  }

  const typeBienBrut = parseTexteOptionnel(formData.get("typeBien"));
  if (typeBienBrut !== undefined && !TYPES_BIEN.includes(typeBienBrut as TypeBien)) {
    throw new ErreurSaisie("Type de bien invalide.");
  }

  return {
    nom,
    prenom: parseTexteOptionnel(formData.get("prenom")),
    email: parseTexteOptionnel(formData.get("email")),
    telephone: parseTexteOptionnel(formData.get("telephone")),
    origineLead: origineLeadBrut as OrigineLead | undefined,
    origineLeadDetail: parseTexteOptionnel(formData.get("origineLeadDetail")),
    adresseBienPotentiel: parseTexteOptionnel(formData.get("adresseBienPotentiel")),
    secteurBienPotentiel: parseTexteOptionnel(formData.get("secteurBienPotentiel")),
    ville: parseTexteOptionnel(formData.get("ville")),
    codePostal: parseTexteOptionnel(formData.get("codePostal")),
    typeBien: typeBienBrut as TypeBien | undefined,
  };
}

// ADR-027, correction n° 6 : aucun placeholder, aucune valeur inventée à la conversion. Réutilise
// parseBienFormData tel quel (mêmes règles que la création d'un bien classique) mais rejette en
// plus explicitement toute soumission dont un champ texte obligatoire de `biens` serait resté
// vide — pré-rempli ou non depuis le prospect (voir ProspectVendeurConversionFormulaire.tsx, qui
// ne pré-remplit `adresse` que depuis adresseBienPotentiel, jamais depuis secteurBienPotentiel).
export function parseSignatureMandatFormData(formData: FormData): NouveauBien {
  const donneesBien = parseBienFormData(formData);
  if (!donneesBien.reference) throw new ErreurSaisie("La référence du bien est obligatoire.");
  if (!donneesBien.titre) throw new ErreurSaisie("Le titre du bien est obligatoire.");
  if (!donneesBien.adresse) {
    throw new ErreurSaisie("L'adresse précise du bien est obligatoire pour créer le bien — un secteur approximatif ne suffit pas.");
  }
  if (!donneesBien.ville) throw new ErreurSaisie("La ville du bien est obligatoire.");
  if (!donneesBien.codePostal) throw new ErreurSaisie("Le code postal du bien est obligatoire.");
  return donneesBien;
}
