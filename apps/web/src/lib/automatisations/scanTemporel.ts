import { getDb } from "@/db/client";
import { listerProspectsVendeurs } from "@/lib/prospectVendeurRepository";
import { calculerOccurrencesInactiviteDues } from "./calculOccurrencesInactivite";
import { getConfigurationAutomatisation } from "./configurationAutomatisationRepository";
import { emettreEvenementEtPreparerExecutions } from "./evenementMetierRepository";
import { traiterExecutionsEnAttente } from "./moteur";
import { demarrerRunScanAutomatisation, terminerRunScanAutomatisation } from "./runScanAutomatisationRepository";

const REGLE_CODE = "inactivite_prospect_vendeur" as const;

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

export type ResultatScanInactiviteProspectVendeur =
  | { execute: false }
  | { execute: true; runId: string; nombreCandidats: number; nombreOccurrencesCreees: number; erreurTechnique?: string };

// Point d'entrée du moteur temporel (ADR-033) — appelé par l'endpoint /api/automatisations/scan,
// lui-même déclenché par un cron EXTERNE (aucun scheduler interne à Atlas). `maintenant` est un
// paramètre explicite, jamais un `new Date()` implicite ici : calculé une seule fois par appel,
// transmis tel quel à la fonction pure de calcul (déterminisme, testabilité).
//
// Si la règle est inactive ou son seuil non configuré, AUCUN run n'est créé — un run représente
// une tentative de scan réellement effectuée, pas la consultation d'un feature flag.
//
// `listerProspectsVendeurs()` (déjà existant, ADR-027) exclut prospects archivés/perdus/mandat
// déjà signé — jamais un filtre réinventé ici (ADR-033, point 9). Chaque occurrence est émise dans
// sa PROPRE transaction courte : un scan portant sur des centaines de prospects ne dépend jamais
// d'un seul verrou long, et une erreur sur un prospect n'affecte jamais les autres.
export async function scannerInactiviteProspectVendeur(
  maintenant: Date = new Date()
): Promise<ResultatScanInactiviteProspectVendeur> {
  const configuration = await getConfigurationAutomatisation(REGLE_CODE);
  if (!configuration.active || configuration.seuilJoursInactivite == null) {
    return { execute: false };
  }

  const runId = await demarrerRunScanAutomatisation(REGLE_CODE);
  let nombreCandidats = 0;
  let nombreOccurrencesCreees = 0;

  try {
    const prospects = await listerProspectsVendeurs();
    nombreCandidats = prospects.length;
    const candidats = prospects.map((p) => ({
      prospectVendeurId: p.id,
      dernierContactLe: p.dernierContactLe,
      creeLe: p.creeLe,
    }));
    const occurrences = calculerOccurrencesInactiviteDues(maintenant, configuration.seuilJoursInactivite, candidats);

    for (const occurrence of occurrences) {
      try {
        const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
          emettreEvenementEtPreparerExecutions(
            {
              typeEvenement: REGLE_CODE,
              prospectVendeurId: occurrence.prospectVendeurId,
              ancreCycle: new Date(occurrence.ancreCycle),
            },
            tx
          )
        );
        // evenement défini = occurrence réellement nouvelle (jamais un rejeu idempotent) —
        // c'est le seul compteur honnête de "occurrences créées", indépendant du nombre
        // d'exécutions effectivement préparées (qui dépend en plus de l'activation, déjà vérifiée
        // pour cette règle mais potentiellement pas pour une future règle réagissant au même type).
        if (evenement) nombreOccurrencesCreees += 1;
        await traiterExecutionsEnAttente(idsExecutionsATraiter);
      } catch (erreur) {
        // Isolée par prospect (ADR-033, point 14) — un crash sur une occurrence ne doit jamais
        // interrompre le scan des suivantes ; le prochain run la retrouvera de toute façon (même
        // ancre, aucune ligne d'événement n'aura été créée pour elle).
        console.error("[automatisations] échec du traitement d'une occurrence d'inactivité :", erreur);
      }
    }

    await terminerRunScanAutomatisation(runId, { nombreCandidats, nombreOccurrencesCreees });
    return { execute: true, runId, nombreCandidats, nombreOccurrencesCreees };
  } catch (erreur) {
    const erreurTechnique = categoriserErreur(erreur);
    await terminerRunScanAutomatisation(runId, { nombreCandidats, nombreOccurrencesCreees, erreurTechnique });
    return { execute: true, runId, nombreCandidats, nombreOccurrencesCreees, erreurTechnique };
  }
}
