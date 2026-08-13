import type {
  AffiliationRetraite,
  NouveauProfilFiscal,
  PeriodiciteUrssaf,
  RegimeComptable,
  RegimeFiscal,
  RegimeTva,
} from "@/types/profilFiscal";

// Même principe que bienFormulaire.parseTriEtat : un select à 3 états (Inconnu/Oui/Non), jamais
// une checkbox, pour ne jamais soumettre "false" par accident quand l'information est inconnue.
export function parseTriEtat(valeur: FormDataEntryValue | null): boolean | undefined {
  if (valeur === "oui") return true;
  if (valeur === "non") return false;
  return undefined;
}

function parseDateOptionnelle(valeur: FormDataEntryValue | null): string | undefined {
  const date = String(valeur ?? "").trim();
  return date !== "" ? date : undefined;
}

const REGIMES_FISCAUX: RegimeFiscal[] = ["micro_bnc", "declaration_controlee", "inconnu"];
const REGIMES_COMPTABLES: RegimeComptable[] = ["caisse", "engagement", "inconnu"];
const REGIMES_TVA: RegimeTva[] = ["franchise", "redevable_reel_simplifie", "redevable_reel_normal", "inconnu"];
const PERIODICITES: PeriodiciteUrssaf[] = ["mensuelle", "trimestrielle", "inconnu"];
const AFFILIATIONS: AffiliationRetraite[] = ["ssi_regime_general", "cipav", "inconnu"];

// Valide les invariants croisés du point 1/ADR-023 : regimeComptable pertinent uniquement en
// déclaration contrôlée (jamais lié au calcul TVA, corrigé), optionDebits pertinent uniquement
// hors franchise, dates ACRE cohérentes uniquement si ACRE actif. Rejette explicitement plutôt que
// d'ignorer silencieusement une valeur incohérente.
export function parseProfilFiscalFormData(dossierFiscalId: string, formData: FormData): NouveauProfilFiscal {
  const dateDebutValidite = String(formData.get("dateDebutValidite") ?? "").trim();
  if (!dateDebutValidite) throw new Error("La date de début de validité de cet instantané est obligatoire.");

  const dateDebutActivite = String(formData.get("dateDebutActivite") ?? "").trim();
  if (!dateDebutActivite) throw new Error("La date de début d'activité est obligatoire.");

  const regimeFiscal = String(formData.get("regimeFiscal") ?? "") as RegimeFiscal;
  if (!REGIMES_FISCAUX.includes(regimeFiscal)) throw new Error("Régime fiscal invalide.");

  const regimeComptableBrut = String(formData.get("regimeComptable") ?? "").trim();
  if (regimeComptableBrut !== "" && !REGIMES_COMPTABLES.includes(regimeComptableBrut as RegimeComptable)) {
    throw new Error("Régime comptable invalide.");
  }
  if (regimeComptableBrut !== "" && regimeFiscal !== "declaration_controlee") {
    throw new Error("Le régime comptable n'est pertinent qu'en déclaration contrôlée.");
  }
  const regimeComptable = regimeComptableBrut === "" ? undefined : (regimeComptableBrut as RegimeComptable);

  const regimeTva = String(formData.get("regimeTva") ?? "") as RegimeTva;
  if (!REGIMES_TVA.includes(regimeTva)) throw new Error("Régime TVA invalide.");

  const optionDebits = parseTriEtat(formData.get("optionDebits"));
  if (optionDebits !== undefined && regimeTva === "franchise") {
    throw new Error("L'option pour les débits n'est pertinente que hors franchise de TVA.");
  }

  const periodiciteUrssaf = String(formData.get("periodiciteUrssaf") ?? "") as PeriodiciteUrssaf;
  if (!PERIODICITES.includes(periodiciteUrssaf)) throw new Error("Périodicité Urssaf invalide.");

  const affiliationRetraite = String(formData.get("affiliationRetraite") ?? "") as AffiliationRetraite;
  if (!AFFILIATIONS.includes(affiliationRetraite)) throw new Error("Affiliation retraite invalide.");

  const acreActif = parseTriEtat(formData.get("acreActif"));
  const acreDateDebut = parseDateOptionnelle(formData.get("acreDateDebut"));
  const acreDateFin = parseDateOptionnelle(formData.get("acreDateFin"));
  if ((acreDateDebut !== undefined || acreDateFin !== undefined) && acreActif !== true) {
    throw new Error("Les dates ACRE ne sont renseignables que si ACRE est actif.");
  }

  return {
    dossierFiscalId,
    dateDebutValidite,
    natureActivite: "agent_commercial_immobilier",
    dateDebutActivite,
    regimeFiscal,
    regimeComptable,
    regimeTva,
    optionDebits,
    periodiciteUrssaf,
    optionVersementLiberatoire: parseTriEtat(formData.get("optionVersementLiberatoire")),
    acreActif,
    acreDateDebut,
    acreDateFin,
    affiliationRetraite,
  };
}
