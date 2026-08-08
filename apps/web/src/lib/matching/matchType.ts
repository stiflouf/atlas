import type { RendezVous, TypeRdv } from "@/types/agenda";
import type { CandidatType, TypeMetierRdv } from "@/types/contexteRendezVous";
import { normaliser } from "./normaliser";

// Un rendez-vous déjà typé côté calendrier (mock) n'a pas besoin de deviner quoi que ce soit.
// "reunion" n'a pas d'équivalent métier dédié dans ce sprint : classé "autre".
const TYPE_CALENDAR_CONNU: Partial<Record<TypeRdv, TypeMetierRdv>> = {
  visite: "visite",
  estimation: "estimation",
  appel: "appel",
  signature: "signature",
  reunion: "autre",
};

const MOTS_CLES: { mots: string[]; type: TypeMetierRdv }[] = [
  { mots: ["visite"], type: "visite" },
  { mots: ["estimation", "avis de valeur", "avis de prix"], type: "estimation" },
  { mots: ["signature", "compromis", "acte"], type: "signature" },
  { mots: ["appel", "telephone", "call"], type: "appel" },
  { mots: ["prospection", "porte a porte", "prise de mandat", "phoning"], type: "prospection" },
];

// Aucune classification IA : uniquement des mots-clés explicites dans le titre.
export function matcherType(rdv: RendezVous): CandidatType {
  const typeConnu = TYPE_CALENDAR_CONNU[rdv.type];
  if (typeConnu) {
    return { type: typeConnu, confidence: 1, matchedBy: "type_calendar_connu" };
  }

  const texte = normaliser(rdv.titre);
  for (const { mots, type } of MOTS_CLES) {
    if (mots.some((mot) => texte.includes(normaliser(mot)))) {
      return { type, confidence: 0.85, matchedBy: "mot_cle_type" };
    }
  }

  return { type: "autre", confidence: 0, matchedBy: "aucun_indice" };
}
