import { and, desc, eq, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { profilFiscal as profilFiscalTable } from "@/db/schema";
import type { NouveauProfilFiscal, ProfilFiscal } from "@/types/profilFiscal";

type LigneProfilFiscal = typeof profilFiscalTable.$inferSelect;

function ligneVersProfilFiscal(ligne: LigneProfilFiscal): ProfilFiscal {
  return {
    id: ligne.id,
    dossierFiscalId: ligne.dossierFiscalId,
    dateDebutValidite: ligne.dateDebutValidite,
    natureActivite: ligne.natureActivite as ProfilFiscal["natureActivite"],
    dateDebutActivite: ligne.dateDebutActivite,
    regimeFiscal: ligne.regimeFiscal as ProfilFiscal["regimeFiscal"],
    regimeComptable: (ligne.regimeComptable as ProfilFiscal["regimeComptable"] | null) ?? undefined,
    regimeTva: ligne.regimeTva as ProfilFiscal["regimeTva"],
    optionDebits: ligne.optionDebits ?? undefined,
    periodiciteUrssaf: ligne.periodiciteUrssaf as ProfilFiscal["periodiciteUrssaf"],
    optionVersementLiberatoire: ligne.optionVersementLiberatoire ?? undefined,
    acreActif: ligne.acreActif ?? undefined,
    acreDateDebut: ligne.acreDateDebut ?? undefined,
    acreDateFin: ligne.acreDateFin ?? undefined,
    affiliationRetraite: ligne.affiliationRetraite as ProfilFiscal["affiliationRetraite"],
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Instantané applicable à la date D (ADR-023) : le plus récent dont dateDebutValidite <= D. Aucune
// contrainte sur l'ordre d'insertion — une correction rétroactive (date_debut_validite antérieure
// à des lignes déjà existantes) est acceptée, elle se glisse simplement dans l'historique lu. En
// cas d'égalité exacte de date_debut_validite entre plusieurs lignes, la plus récemment créée
// (creeLe) fait foi — départage non ambigu, aucune ligne n'est jamais supprimée ni modifiée.
export async function chargerProfilFiscalADate(
  dossierFiscalId: string,
  date: string
): Promise<ProfilFiscal | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(profilFiscalTable)
    .where(and(eq(profilFiscalTable.dossierFiscalId, dossierFiscalId), lte(profilFiscalTable.dateDebutValidite, date)))
    .orderBy(desc(profilFiscalTable.dateDebutValidite), desc(profilFiscalTable.creeLe))
    .limit(1);
  return ligne ? ligneVersProfilFiscal(ligne) : undefined;
}

export async function chargerProfilFiscalActuel(dossierFiscalId: string): Promise<ProfilFiscal | undefined> {
  const aujourdHui = new Date().toISOString().slice(0, 10);
  return chargerProfilFiscalADate(dossierFiscalId, aujourdHui);
}

// Historique complet, du plus récent au plus ancien (même ordre de tri que la résolution) — pour
// un futur écran d'audit, pas encore exposé en V1.
export async function chargerHistoriqueProfilFiscal(dossierFiscalId: string): Promise<ProfilFiscal[]> {
  const lignes = await getDb()
    .select()
    .from(profilFiscalTable)
    .where(eq(profilFiscalTable.dossierFiscalId, dossierFiscalId))
    .orderBy(desc(profilFiscalTable.dateDebutValidite), desc(profilFiscalTable.creeLe));
  return lignes.map(ligneVersProfilFiscal);
}

// Insertion pure, append-only — jamais d'update. Les invariants croisés (regimeComptable pertinent
// seulement en déclaration contrôlée, optionDebits pertinent seulement hors franchise, cohérence
// des dates ACRE) sont entièrement portés par la Server Action (src/actions/profilFiscal.ts).
export async function enregistrerProfilFiscal(input: NouveauProfilFiscal): Promise<ProfilFiscal> {
  const [ligne] = await getDb()
    .insert(profilFiscalTable)
    .values({
      dossierFiscalId: input.dossierFiscalId,
      dateDebutValidite: input.dateDebutValidite,
      natureActivite: input.natureActivite,
      dateDebutActivite: input.dateDebutActivite,
      regimeFiscal: input.regimeFiscal,
      regimeComptable: input.regimeComptable ?? null,
      regimeTva: input.regimeTva,
      optionDebits: input.optionDebits ?? null,
      periodiciteUrssaf: input.periodiciteUrssaf,
      optionVersementLiberatoire: input.optionVersementLiberatoire ?? null,
      acreActif: input.acreActif ?? null,
      acreDateDebut: input.acreDateDebut ?? null,
      acreDateFin: input.acreDateFin ?? null,
      affiliationRetraite: input.affiliationRetraite,
    })
    .returning();
  return ligneVersProfilFiscal(ligne);
}
