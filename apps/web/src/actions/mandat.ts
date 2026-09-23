"use server";

import { notFound, redirect } from "next/navigation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { enregistrerMandatExistant, modifierMandat, resilierMandat } from "@/lib/mandatRepository";
import { parseDateObligatoire, parseFaitsMandatFormData, parseMotifResiliation } from "@/lib/mandatFormulaire";
import { ajouterPartieMandat, modifierRolePartieMandat, retirerPartieMandat } from "@/lib/partieMandatRepository";
import { estRolePartieMandat } from "@/types/partieMandat";
import { ErreurSaisie } from "@/lib/formulaires/etatFormulaire";

// ADR-060 §13, §16 — les GESTES HUMAINS sur le mandat canonique et ses parties (lot
// MANDATE_CANONICAL_UI_V1). Pipeline identique pour chacun : session → workspace de SESSION (jamais
// depuis le formulaire) → parsing/validation → writer du repository (qui relit sous verrou et rend
// un résultat typé) → redirection vers la fiche du bien, un refus métier étant rapporté à l'écran
// par le paramètre `mandat=` et jamais avalé. Aucun SQL ici : les repositories seuls parlent à
// Postgres (ADR-007).
//
// `bienId` du formulaire ne sert qu'à la NAVIGATION de retour : jamais à décider quoi écrire. Un
// mandat introuvable (inconnu OU d'un autre workspace, indistinguables) est un `notFound()`.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DEMO_UX_HARDENING_V1 — une saisie invalide (date mal formée, type de mandat absent) est un refus
// comme les autres : elle rejoint le canal `?mandat=` déjà lu par la fiche Bien et traduit par
// `MESSAGES_REFUS`, au lieu de remonter en page d'erreur. Le panneau garde ses sept formulaires et
// sa navigation de retour — c'est elle qui recharge le bien avec des données fraîches.
//
// N'enveloppe QUE le parsing : jamais un writer (dont les refus sont déjà typés), jamais un
// `redirect()` (qui lève par conception et doit traverser intact).
function saisieValide<T>(formData: FormData, lire: () => T): T {
  try {
    return lire();
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) redirect(cheminRetour(formData, "saisie_invalide"));
    throw erreur;
  }
}

function cheminRetour(formData: FormData, refus?: string): string {
  const bienId = String(formData.get("bienId") ?? "");
  if (!UUID_REGEX.test(bienId)) notFound();
  return refus ? `/biens/${bienId}?mandat=${refus}#mandat` : `/biens/${bienId}#mandat`;
}

export async function modifierMandatAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const mandatId = String(formData.get("mandatId") ?? "");
  if (!mandatId) notFound();

  const faits = saisieValide(formData, () => parseFaitsMandatFormData(formData));
  const resultat = await modifierMandat(mandatId, faits, workspaceId);
  if (resultat.statut === "introuvable") notFound();
  if (resultat.statut !== "modifie") redirect(cheminRetour(formData, resultat.statut));
  redirect(`/biens/${resultat.mandat.bienId}#mandat`);
}

export async function resilierMandatAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const mandatId = String(formData.get("mandatId") ?? "");
  if (!mandatId) notFound();

  const resilieLe = saisieValide(formData, () => parseDateObligatoire(formData.get("resilieLe"), "Date de résiliation"));
  const motifResiliation = parseMotifResiliation(formData.get("motifResiliation"));
  const resultat = await resilierMandat(mandatId, { resilieLe, motifResiliation }, workspaceId);
  if (resultat.statut === "introuvable") notFound();
  if (resultat.statut !== "resilie") redirect(cheminRetour(formData, resultat.statut));
  redirect(`/biens/${resultat.mandat.bienId}#mandat`);
}

// ADR-060 §15 — « Enregistrer le mandat existant » : la date de prise d'effet est SOUMISE par
// l'humain (le formulaire peut la préremplir depuis `biens.date_mandat`, il ne la copie jamais
// silencieusement — la valeur transite par le champ, visible et modifiable).
export async function enregistrerMandatExistantAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const bienId = String(formData.get("bienId") ?? "");
  if (!UUID_REGEX.test(bienId)) notFound();

  const { dateDebut, faits } = saisieValide(formData, () => ({
    dateDebut: parseDateObligatoire(formData.get("dateDebutMandat"), "Date de prise d'effet"),
    faits: parseFaitsMandatFormData(formData),
  }));
  const resultat = await enregistrerMandatExistant(bienId, { ...faits, dateDebut }, workspaceId);
  if (resultat.statut === "bien_introuvable") notFound();
  if (resultat.statut !== "enregistre") redirect(cheminRetour(formData, resultat.statut));
  redirect(`/biens/${bienId}#mandat`);
}

export async function ajouterPartieMandatAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const mandatId = String(formData.get("mandatId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!mandatId || !contactId) notFound();
  if (!estRolePartieMandat(role)) throw new Error("Le rôle est obligatoire : mandant ou représentant.");

  const resultat = await ajouterPartieMandat(mandatId, { contactId, role }, workspaceId);
  if (resultat.statut === "mandat_introuvable") notFound();
  if (resultat.statut !== "ajoutee") redirect(cheminRetour(formData, resultat.statut));
  redirect(cheminRetour(formData));
}

export async function modifierRolePartieMandatAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const partieId = String(formData.get("partieId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!partieId) notFound();
  if (!estRolePartieMandat(role)) throw new Error("Le rôle est obligatoire : mandant ou représentant.");

  const resultat = await modifierRolePartieMandat(partieId, role, workspaceId);
  if (resultat.statut === "introuvable") notFound();
  redirect(cheminRetour(formData));
}

export async function retirerPartieMandatAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const partieId = String(formData.get("partieId") ?? "");
  if (!partieId) notFound();

  const resultat = await retirerPartieMandat(partieId, workspaceId);
  if (resultat.statut === "introuvable") notFound();
  redirect(cheminRetour(formData));
}
