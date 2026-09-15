"use server";

import { notFound, redirect } from "next/navigation";
import { exigerSessionAtlas, lireSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { fusionnerContacts } from "@/lib/fusionContactRepository";
import { preparerFusionContacts } from "@/lib/preparationFusionContactRepository";
import {
  CHAMPS_IDENTITE_CONTACT,
  type ChampIdentiteContact,
  type ChoixFusionChamp,
  type ChoixFusionParChamp,
  type IdentiteContactSnapshot,
} from "@/types/contactFusion";

// ADR-059 — LA Server Action de fusion. Elle ORCHESTRE : session, workspace, lecture de l'état
// courant, traduction du formulaire, UN appel au moteur, redirection. Elle ne décide rien et
// n'écrit rien elle-même ; toute règle métier est dans le moteur, qui revérifie tout sous verrou.
//
// Le navigateur n'est jamais la source de vérité : les identités « attendues » transmises au moteur
// viennent d'une RELECTURE serveur, et le formulaire ne porte que la date de modification qu'il a
// vue. Si elle diffère de celle relue, la page était périmée : refus avant même d'appeler le
// moteur. Un champ caché altéré ne peut donc provoquer qu'un refus, jamais une fusion différente.
//
// Refus = redirection vers la page de comparaison avec un code (patron rattacherContact), jamais
// une page d'erreur : l'humain reprend là où il était, avec l'état recalculé.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHOIX_VALIDES: readonly ChoixFusionChamp[] = ["survivant", "absorbe", "identique", "absence_comblee"];

export type CodeRefusFusion =
  | "confirmation_requise"
  | "choix_manquant"
  | "deja_fusionne"
  | "identite_modifiee_entre_temps"
  | "choix_identite_invalide"
  | "avertissement_requis"
  | "page_perimee";

function urlComparaison(survivantId: string, absorbeId: string, refus?: CodeRefusFusion, champ?: ChampIdentiteContact): string {
  const base = `/contacts/${survivantId}/fusionner/${absorbeId}`;
  if (!refus) return base;
  const params = new URLSearchParams({ fusion: refus });
  if (champ) params.set("champ", champ);
  return `${base}?${params.toString()}`;
}

function lireChoix(formData: FormData): Partial<ChoixFusionParChamp> {
  const choix: Partial<ChoixFusionParChamp> = {};
  for (const champ of CHAMPS_IDENTITE_CONTACT) {
    const valeur = String(formData.get(`choix_${champ}`) ?? "");
    if ((CHOIX_VALIDES as readonly string[]).includes(valeur)) choix[champ] = valeur as ChoixFusionChamp;
  }
  return choix;
}

// L'identité finale se DÉDUIT du choix et des deux identités relues — jamais d'un champ libre.
function identiteFinale(
  choix: ChoixFusionParChamp,
  survivant: IdentiteContactSnapshot,
  absorbe: IdentiteContactSnapshot
): IdentiteContactSnapshot {
  const valeur = (champ: ChampIdentiteContact): string | undefined => {
    switch (choix[champ]) {
      case "survivant":
      case "identique":
        return survivant[champ];
      case "absorbe":
        return absorbe[champ];
      case "absence_comblee":
        return survivant[champ] ?? absorbe[champ];
    }
  };
  return { nom: valeur("nom") ?? "", prenom: valeur("prenom"), email: valeur("email"), telephone: valeur("telephone") };
}

export async function fusionnerContactsAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  // ADR-054 — le périmètre vient de la session, jamais du formulaire ; l'acteur du journal aussi.
  const workspaceId = await exigerWorkspaceCourant();
  const acteur = await lireSessionAtlas();
  const survivantId = String(formData.get("survivantId") ?? "");
  const absorbeId = String(formData.get("absorbeId") ?? "");
  if (!UUID_REGEX.test(survivantId) || !UUID_REGEX.test(absorbeId) || survivantId === absorbeId) notFound();

  if (formData.get("confirmation") !== "oui") {
    redirect(urlComparaison(survivantId, absorbeId, "confirmation_requise"));
  }

  const preparation = await preparerFusionContacts({ workspaceId, contactSurvivantId: survivantId, contactAbsorbeId: absorbeId });
  if (preparation.statut === "contact_introuvable" || preparation.statut === "meme_contact") notFound();
  if (preparation.statut === "deja_fusionne") redirect(urlComparaison(survivantId, absorbeId, "deja_fusionne"));

  // Ce que la page a montré doit être ce qui existe encore.
  if (
    formData.get("survivantModifieLe") !== preparation.survivant.identiteAttendue.modifieLe ||
    formData.get("absorbeModifieLe") !== preparation.absorbe.identiteAttendue.modifieLe
  ) {
    redirect(urlComparaison(survivantId, absorbeId, "identite_modifiee_entre_temps"));
  }

  const choixPartiel = lireChoix(formData);
  const manquant = CHAMPS_IDENTITE_CONTACT.find((champ) => choixPartiel[champ] === undefined);
  if (manquant) redirect(urlComparaison(survivantId, absorbeId, "choix_manquant", manquant));
  const choixParChamp = choixPartiel as ChoixFusionParChamp;

  const avertissementsAcquittes = formData.getAll("acquittement").map(String);

  const resultat = await fusionnerContacts({
    workspaceId,
    contactSurvivantId: survivantId,
    contactAbsorbeId: absorbeId,
    identiteAttendueSurvivant: preparation.survivant.identiteAttendue,
    identiteAttendueAbsorbe: preparation.absorbe.identiteAttendue,
    identiteFinale: identiteFinale(choixParChamp, preparation.survivant.identiteAttendue, preparation.absorbe.identiteAttendue),
    choixParChamp,
    acteur: { sub: acteur?.sub, email: acteur?.email },
    avertissementsAcquittes,
  });

  switch (resultat.statut) {
    case "fusionne":
      redirect(`/contacts/${resultat.contactSurvivantId}`);
    case "meme_contact":
    case "contact_introuvable":
      notFound();
    case "deja_fusionne":
      redirect(urlComparaison(survivantId, absorbeId, "deja_fusionne"));
    case "identite_modifiee_entre_temps":
      redirect(urlComparaison(survivantId, absorbeId, "identite_modifiee_entre_temps"));
    case "choix_identite_invalide":
      redirect(urlComparaison(survivantId, absorbeId, "choix_identite_invalide", resultat.champ));
    case "avertissement_reference_externe_requis":
      redirect(urlComparaison(survivantId, absorbeId, "avertissement_requis"));
    case "acquittement_inconnu":
      redirect(urlComparaison(survivantId, absorbeId, "page_perimee"));
  }
}
