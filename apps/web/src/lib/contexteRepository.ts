import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memoireContextuelle } from "@/db/schema";
import type { RendezVous } from "@/types/agenda";
import type { ContexteRendezVous, TypeMetierRdv } from "@/types/contexteRendezVous";
import { construireContexte, type Referentiel } from "@/lib/matching";
import { calculerConfianceGlobale } from "@/lib/matching/resoudre";

// Ce sprint n'écrit et ne lit que des éléments Google Calendar. La table memoire_contextuelle
// est générique (voir ADR-006) : un futur connecteur écrira ses propres source/typeElement,
// jamais de nouvelle table.
const SOURCE_GOOGLE_CALENDAR = "google_calendar";
const TYPE_ELEMENT_EVENEMENT = "evenement";

export type DecisionValidation = "confirme" | "corrige" | "ignore";

type LigneMemoire = typeof memoireContextuelle.$inferSelect;

// Empreinte des champs réellement utilisés par le matching — pas le champ `updated` de Google,
// qui change aussi pour des raisons sans rapport (réponse d'invité, rappel modifié).
export function calculerEmpreinte(rdv: RendezVous): string {
  const contenu = JSON.stringify({
    titre: rdv.titre,
    lieu: rdv.lieu ?? null,
    heure: rdv.heure,
    date: rdv.date ?? null,
    journeeEntiere: Boolean(rdv.journeeEntiere),
    type: rdv.type,
  });
  return createHash("sha256").update(contenu).digest("hex");
}

function ligneVersContexte(ligne: LigneMemoire, rendezVousId: string): ContexteRendezVous {
  const source = ligne.statutValidation === "confirme" || ligne.statutValidation === "corrige"
    ? "validation_humaine"
    : "cache_persiste";

  return {
    rendezVousId,
    bien: ligne.bienId ? { bienId: ligne.bienId, confidence: ligne.confidenceBien ?? 0, matchedBy: source } : undefined,
    client: ligne.clientId
      ? { clientId: ligne.clientId, confidence: ligne.confidenceClient ?? 0, matchedBy: source }
      : undefined,
    typeMetier: {
      type: ligne.typeMetier as TypeMetierRdv,
      confidence: ligne.confidenceType ?? 0,
      matchedBy: source,
    },
    // Une ligne persistée (confirmée, corrigée, ignorée, ou mise en cache) n'a par construction
    // plus besoin de confirmation : l'état ambigu n'est jamais mis en cache (voir plus bas).
    necessiteConfirmationBien: false,
    overallConfidence: ligne.overallConfidence,
  };
}

// WORKSPACE_SCOPING_V2D1 — la clé de lecture est le TRIPLET, jamais le couple. Un même événement
// Calendar peut légitimement avoir une conclusion différente dans deux workspaces : ils ne matchent
// plus contre le même référentiel. Lire sans périmètre rendait à l'un la décision de l'autre.
async function lireLigne(identifiantExterne: string, workspaceId: string): Promise<LigneMemoire | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(memoireContextuelle)
    .where(
      and(
        eq(memoireContextuelle.workspaceId, workspaceId),
        eq(memoireContextuelle.source, SOURCE_GOOGLE_CALENDAR),
        eq(memoireContextuelle.identifiantExterne, identifiantExterne)
      )
    )
    .limit(1);
  return ligne;
}

// La cible de l'`ON CONFLICT` est le TRIPLET — c'est ce point précis qui faisait écraser la
// décision humaine d'un workspace par le cache automatique d'un autre (même faille que
// `configurations_automatisation` avant la migration 0054). Une garde structurelle le verrouille.
async function upsert(
  identifiantExterne: string,
  workspaceId: string,
  valeurs: {
    bienId: string | null;
    clientId: string | null;
    typeMetier: string;
    confidenceBien: number | null;
    confidenceClient: number | null;
    confidenceType: number | null;
    overallConfidence: number;
    statutValidation: string;
    empreinteContenu: string | null;
  }
): Promise<void> {
  await getDb()
    .insert(memoireContextuelle)
    .values({
      workspaceId,
      source: SOURCE_GOOGLE_CALENDAR,
      typeElement: TYPE_ELEMENT_EVENEMENT,
      identifiantExterne,
      ...valeurs,
    })
    .onConflictDoUpdate({
      target: [memoireContextuelle.workspaceId, memoireContextuelle.source, memoireContextuelle.identifiantExterne],
      set: { ...valeurs, modifieLe: new Date() },
    });
}

// Résout le contexte métier d'un rendez-vous Google en respectant la priorité :
// validation humaine > cache (empreinte inchangée) > moteur de matching. Le cas ambigu
// (necessiteConfirmationBien) n'est jamais mis en cache — il est recalculé à chaque fois,
// ce qui est peu coûteux et évite de perdre les candidats en cas de panne d'écriture.
// Toute panne d'accès à la base dégrade silencieusement vers un calcul à la volée.
export async function resoudreContextePersiste(
  rdv: RendezVous,
  referentiel: Referentiel,
  workspaceId: string
): Promise<ContexteRendezVous> {
  try {
    const ligne = await lireLigne(rdv.id, workspaceId);

    if (ligne && (ligne.statutValidation === "confirme" || ligne.statutValidation === "corrige")) {
      return ligneVersContexte(ligne, rdv.id);
    }

    if (ligne && ligne.statutValidation === "ignore") {
      return ligneVersContexte(ligne, rdv.id);
    }

    const empreinte = calculerEmpreinte(rdv);
    if (ligne && ligne.statutValidation === "auto" && ligne.empreinteContenu === empreinte) {
      return ligneVersContexte(ligne, rdv.id);
    }

    const contexte = construireContexte(rdv, referentiel);
    if (!contexte.necessiteConfirmationBien) {
      await upsert(rdv.id, workspaceId, {
        bienId: contexte.bien?.bienId ?? null,
        clientId: contexte.client?.clientId ?? null,
        typeMetier: contexte.typeMetier?.type ?? "autre",
        confidenceBien: contexte.bien?.confidence ?? null,
        confidenceClient: contexte.client?.confidence ?? null,
        confidenceType: contexte.typeMetier?.confidence ?? null,
        overallConfidence: contexte.overallConfidence,
        statutValidation: "auto",
        empreinteContenu: empreinte,
      });
    }
    return contexte;
  } catch (erreur) {
    console.error("[memoire-contextuelle] accès à la base indisponible, calcul à la volée :", erreur);
    return construireContexte(rdv, referentiel);
  }
}

export async function resoudreContextesPersistes(
  rendezVous: RendezVous[],
  referentiel: Referentiel,
  workspaceId: string
): Promise<Map<string, ContexteRendezVous>> {
  const entrees = await Promise.all(
    rendezVous.map(async (rdv) => [rdv.id, await resoudreContextePersiste(rdv, referentiel, workspaceId)] as const)
  );
  return new Map(entrees);
}

// Une correction humaine a toujours priorité sur le moteur déterministe (ADR-006) : on
// snapshotte le client/type actuellement résolus et on fige le bien choisi par le conseiller,
// avec une confiance maximale puisqu'un humain l'a validé.
export async function enregistrerDecisionHumaine(
  rdv: RendezVous,
  contexteActuel: ContexteRendezVous,
  decision: DecisionValidation,
  bienIdChoisi: string | null,
  workspaceId: string
): Promise<void> {
  const bienRetenu = decision === "ignore" ? null : bienIdChoisi;
  const bienCandidat = bienRetenu
    ? { bienId: bienRetenu, confidence: 1, matchedBy: "validation_humaine" as const }
    : undefined;

  await upsert(rdv.id, workspaceId, {
    bienId: bienRetenu,
    clientId: contexteActuel.client?.clientId ?? null,
    typeMetier: contexteActuel.typeMetier?.type ?? "autre",
    confidenceBien: bienRetenu ? 1 : null,
    confidenceClient: contexteActuel.client?.confidence ?? null,
    confidenceType: contexteActuel.typeMetier?.confidence ?? null,
    overallConfidence: calculerConfianceGlobale(bienCandidat, contexteActuel.client, contexteActuel.typeMetier),
    statutValidation: decision,
    empreinteContenu: calculerEmpreinte(rdv),
  });
}
