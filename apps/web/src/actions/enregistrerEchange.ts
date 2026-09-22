"use server";

import { redirect } from "next/navigation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";
import { enregistrerEchangeManuel } from "@/lib/interactionRepository";
import { parseCodeContexteEchange } from "@/lib/timelineContactRepository";
import { echangeManuelParCode } from "@/types/timelineContact";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Dérive d'horloge tolérée entre le poste du conseiller et le serveur — jamais de quoi noter
// volontairement un échange à venir.
const TOLERANCE_FUTUR_MS = 5 * 60 * 1000;
const LONGUEUR_MAX_CONTENU = 4000;

// Le formulaire soumet un `datetime-local` ("YYYY-MM-DDTHH:mm", heure locale du navigateur) ou un
// instant ISO complet. Sans fuseau, on interprète comme l'heure de l'application (Europe/Paris) :
// le produit est mono-conseiller, en France.
function parseSurvenuLe(brut: string): Date | undefined {
  const valeur = brut.trim();
  if (valeur === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(valeur)) {
    const [date, heure] = valeur.split("T");
    const enParis = new Date(`${date}T${heure.length === 5 ? `${heure}:00` : heure}Z`);
    if (Number.isNaN(enParis.getTime())) return undefined;
    // Décalage Europe/Paris à cet instant (1 h ou 2 h) : la valeur saisie est locale, pas UTC.
    const decalageMinutes = decalageParis(enParis);
    return new Date(enParis.getTime() - decalageMinutes * 60 * 1000);
  }
  const instant = new Date(valeur);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
}

function decalageParis(date: Date): number {
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(date);
  const offset = parties.find((p) => p.type === "timeZoneName")?.value ?? "UTC+1";
  const m = /([+-])(\d{1,2})(?::(\d{2}))?/.exec(offset);
  if (!m) return 60;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

// CRM_TIMELINE_V1 — « Noter un échange » depuis la fiche Contact. Contrat FORM_FEEDBACK_V1 :
// session puis workspace AVANT toute validation, refus de saisie et refus métier attendus rendus au
// formulaire (`ErreurSaisie`), le reste (session, DB, invariant) continue à lever. Succès = retour
// à la fiche Contact, où la timeline montre l'échange.
export async function enregistrerEchangeAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const contactId = String(formData.get("contactId") ?? "").trim();
    const code = String(formData.get("echange") ?? "").trim();
    const contenu = String(formData.get("contenu") ?? "").trim();
    const contexteBrut = String(formData.get("contexte") ?? "").trim();
    const survenuLeBrut = String(formData.get("survenuLe") ?? "");

    if (!UUID_REGEX.test(contactId)) throw new ErreurSaisie("Contact introuvable.");
    const echange = echangeManuelParCode(code);
    if (!echange) throw new ErreurSaisie("Choisissez le type d'échange.");
    if (!contenu) throw new ErreurSaisie("Notez ce qui s'est dit : le contenu est obligatoire.");
    if (contenu.length > LONGUEUR_MAX_CONTENU) throw new ErreurSaisie(`Le contenu dépasse ${LONGUEUR_MAX_CONTENU} caractères.`);
    const survenuLe = parseSurvenuLe(survenuLeBrut);
    if (!survenuLe) throw new ErreurSaisie("Indiquez la date et l'heure de l'échange.");
    if (survenuLe.getTime() > Date.now() + TOLERANCE_FUTUR_MS) throw new ErreurSaisie("Un échange ne peut pas être noté à une date future.");
    const contexte = contexteBrut ? parseCodeContexteEchange(contexteBrut) : undefined;
    if (contexteBrut && !contexte) throw new ErreurSaisie("Le contexte choisi n'est pas valide.");

    const resultat = await enregistrerEchangeManuel(
      { contactId, type: echange.type, sens: echange.sens, survenuLe: survenuLe.toISOString(), contenu, contexte },
      workspaceId
    );
    if (resultat.statut === "contact_introuvable") throw new ErreurSaisie("Contact introuvable dans votre espace.");
    if (resultat.statut === "contact_fusionne") throw new ErreurSaisie("Ce contact a été fusionné : notez l'échange sur la fiche qui l'a absorbé.");
    if (resultat.statut === "contexte_invalide") throw new ErreurSaisie("Ce contexte n'est pas relié à ce contact.");

    redirect(`/contacts/${contactId}`);
  });
}
