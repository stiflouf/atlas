import { calculerChecklistDossier, type ContexteDossier } from "./checklistDossier";
import { LABEL_CHARGE_HONORAIRES } from "@/types/bien";
import { LABEL_TYPE_DOCUMENT, type DocumentBien } from "@/types/documentBien";
import type { ProfilAcquereur } from "@/types/client";

// Contexte du pack notaire (ADR-030) — étend ContexteDossier (ADR-029) d'un acquéreur déjà
// résolu, nécessaire au nommage d'export et au manifeste. N'étend jamais ContexteDossier
// lui-même (checklistDossier.ts reste inchangé, aucune dépendance inversée).
export type ContextePackNotaire = ContexteDossier & { acquereur?: ProfilAcquereur };

// Sévérités d'un constat (ADR-030) : aucun critère juridique bloquant. `bloquant_technique` est
// strictement réservé à une impossibilité SÛRE/FACTUELLE d'inclure un document (rattachement
// structurellement contradictoire, classement rejeté, fichier illisible à l'export) — jamais une
// exigence produit manquante (`a_obtenir`) ni une incertitude de validité/rapprochement textuel
// (`a_verifier`), qui restent toutes deux de simples signaux, jamais des blocages.
export type SeveritePackNotaire = "a_obtenir" | "a_verifier" | "information" | "bloquant_technique";

export const LABEL_SEVERITE_PACK_NOTAIRE: Record<SeveritePackNotaire, string> = {
  a_obtenir: "À obtenir",
  a_verifier: "À vérifier",
  information: "Information",
  bloquant_technique: "Bloquant",
};

export type ConstatPackNotaire = {
  code: string;
  severite: SeveritePackNotaire;
  message: string;
  documentId?: string;
};

// Jamais une prétention juridique ("dossier complet/accepté par le notaire") — uniquement un
// état PRODUIT décrivant ce que les contrôles Atlas actuellement implémentés détectent.
// `contexte_transactionnel_incomplet` : aucun compromis en cours n'existe pour ce bien, la notion
// même de "prêt à transmettre" est dénuée de sens (rien à transmettre) — jamais assimilé à "non".
export type EtatPreparationPack =
  | "contexte_transactionnel_incomplet"
  | "elements_bloquants"
  | "elements_a_traiter"
  | "preparation_atlas_complete";

export const LABEL_ETAT_PREPARATION_PACK: Record<EtatPreparationPack, string> = {
  contexte_transactionnel_incomplet: "Contexte transactionnel incomplet",
  elements_bloquants: "Éléments bloquants",
  elements_a_traiter: "Éléments à traiter",
  preparation_atlas_complete: "Préparation Atlas complète (contrôles Atlas actuellement implémentés uniquement)",
};

export type PackNotaire = {
  etatPreparation: EtatPreparationPack;
  constats: ConstatPackNotaire[];
  // Jamais sélectionnables, même manuellement — rattachement structurellement contradictoire ou
  // classement rejeté (ADR-030).
  documentsInterdits: DocumentBien[];
  // Auto-cochés : etatVerification = 'confirme' ET la checklist les retient comme satisfaisant
  // une exigence à l'état 'present' (ou PV AG présent) — jamais un document 'a_verifier'/
  // 'non_verifie' même si la checklist le juge 'present' (primauté anti-mauvais-dossier sur la
  // commodité, ADR-030).
  selectionProposee: DocumentBien[];
  // Visibles, sélection manuelle possible par le conseiller pour cet export — jamais persistée.
  documentsDisponibles: DocumentBien[];
};

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}

function texteEquivalent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Moteur déterministe (ADR-030) : consomme calculerChecklistDossier() (ADR-029) tel quel, ne
// réimplémente aucune règle de présence/validité documentaire — se contente de classer son
// résultat en constats à sévérité, et d'ajouter la détection anti-mauvais-dossier (rattachements
// structurels), absente de la checklist elle-même.
export function calculerPackNotaire(
  ctx: ContextePackNotaire,
  documents: DocumentBien[],
  maintenant: Date = new Date()
): PackNotaire {
  const checklist = calculerChecklistDossier(ctx, documents, maintenant);
  const constats: ConstatPackNotaire[] = [];
  const idsInterdits = new Set<string>();

  // 1) Constats dérivés des exigences de checklist — jamais réimplémenté, seulement classé.
  for (const exigence of checklist.exigences) {
    if (exigence.etat === "manquant") {
      constats.push({ code: `manquant_${exigence.code}`, severite: "a_obtenir", message: `${exigence.label} manquant` });
    } else if (exigence.etat === "perime" && exigence.document?.dateFinValidite) {
      // Constat FACTUEL uniquement ("date dépassée") — jamais la conclusion juridique
      // "transmission impossible" : ADR-030 n'a aucun référentiel légal de validité.
      constats.push({
        code: `perime_${exigence.code}`,
        severite: "a_verifier",
        message: `${exigence.label} : date de fin de validité renseignée dépassée le ${formatDateFr(exigence.document.dateFinValidite)}`,
        documentId: exigence.document.id,
      });
    } else if (exigence.etat === "a_verifier" && exigence.document) {
      constats.push({
        code: `a_verifier_${exigence.code}`,
        severite: "a_verifier",
        message: `${exigence.label} à vérifier`,
        documentId: exigence.document.id,
      });
    } else if (exigence.etat === "incoherent" && exigence.document) {
      constats.push({
        code: `incoherent_${exigence.code}`,
        severite: "bloquant_technique",
        message: `${exigence.label} : classement du document signalé incorrect, à corriger avant transmission`,
        documentId: exigence.document.id,
      });
      idsInterdits.add(exigence.document.id);
    }
  }

  // 2) Honoraires — fait de mandat (biens.chargeHonoraires), jamais confondu avec
  // remuneration.montantRemunerationConseillerCentimes (ADR-021).
  if (!checklist.honorairesRenseignes) {
    constats.push({
      code: "honoraires_non_renseignes",
      severite: "a_obtenir",
      message: "Charge des honoraires non renseignée",
    });
  }

  // 3) PV AG — décompte dérivé (ADR-029), pertinent seulement si une copropriété est renseignée.
  if (ctx.bien.nomCopropriete && checklist.pvAg.presents.length < checklist.pvAg.attendus) {
    constats.push({
      code: "copropriete_pv_ag_incomplet",
      severite: "a_obtenir",
      message: `PV d'assemblée générale : ${checklist.pvAg.presents.length} sur ${checklist.pvAg.attendus} derniers présents`,
    });
  }

  // 4) Anti-mauvais-dossier — balayage structurel de TOUS les documents du bien, indépendant de
  // toute correspondance par type (une information de rattachement explicite prime toujours sur
  // une simple ressemblance de type documentaire). Une contradiction n'existe que si une
  // référence existe réellement pour comparer (compromisActuel/prospectVendeurOrigine) ; en
  // l'absence de référence, la correspondance est seulement "impossible à établir" (a_verifier),
  // jamais une contradiction démontrée (bloquant_technique).
  for (const doc of documents) {
    if (doc.etatVerification === "rejete") {
      constats.push({
        code: `rejete_${doc.id}`,
        severite: "bloquant_technique",
        message: `« ${doc.nom} » : classement signalé incorrect, à corriger avant transmission`,
        documentId: doc.id,
      });
      idsInterdits.add(doc.id);
      continue;
    }

    if (doc.compromisId) {
      if (ctx.compromisActuel) {
        if (doc.compromisId !== ctx.compromisActuel.id) {
          constats.push({
            code: `contradiction_compromis_${doc.id}`,
            severite: "bloquant_technique",
            message: `« ${doc.nom} » est rattaché à un autre compromis. Il ne peut pas être ajouté à ce pack sans correction préalable.`,
            documentId: doc.id,
          });
          idsInterdits.add(doc.id);
        }
      } else {
        constats.push({
          code: `contexte_compromis_indisponible_${doc.id}`,
          severite: "a_verifier",
          message: `« ${doc.nom} » est rattaché à un compromis, mais aucun compromis en cours n'est disponible pour ce dossier — correspondance à vérifier.`,
          documentId: doc.id,
        });
      }
    }

    if (doc.acquereurId) {
      if (ctx.compromisActuel) {
        if (doc.acquereurId !== ctx.compromisActuel.acquereurId) {
          constats.push({
            code: `contradiction_acquereur_${doc.id}`,
            severite: "bloquant_technique",
            message: `« ${doc.nom} » est rattaché à un autre acquéreur. Il ne peut pas être ajouté à ce pack sans correction préalable.`,
            documentId: doc.id,
          });
          idsInterdits.add(doc.id);
        }
      } else {
        constats.push({
          code: `contexte_acquereur_indisponible_${doc.id}`,
          severite: "a_verifier",
          message: `« ${doc.nom} » est rattaché à un acquéreur, mais aucun compromis en cours ne permet de confirmer la correspondance.`,
          documentId: doc.id,
        });
      }
    }

    if (doc.prospectVendeurId) {
      if (ctx.prospectVendeurOrigine) {
        if (doc.prospectVendeurId !== ctx.prospectVendeurOrigine.id) {
          constats.push({
            code: `contradiction_prospect_vendeur_${doc.id}`,
            severite: "bloquant_technique",
            message: `« ${doc.nom} » est rattaché à un autre contact vendeur principal. Il ne peut pas être ajouté à ce pack sans correction préalable.`,
            documentId: doc.id,
          });
          idsInterdits.add(doc.id);
        }
      } else {
        constats.push({
          code: `contexte_prospect_vendeur_indisponible_${doc.id}`,
          severite: "a_verifier",
          message: `« ${doc.nom} » est rattaché à un prospect vendeur, mais ce bien n'a pas de contact vendeur principal identifié — correspondance à vérifier.`,
          documentId: doc.id,
        });
      }
    }

    // Divergence DÉCLARATIVE copropriété/adresse — texte libre saisi par le conseiller, jamais
    // une preuve structurelle : toujours a_verifier, jamais bloquant_technique (ADR-030).
    if (doc.coproprieteDeclaree && ctx.bien.nomCopropriete && !texteEquivalent(doc.coproprieteDeclaree, ctx.bien.nomCopropriete)) {
      constats.push({
        code: `divergence_copropriete_${doc.id}`,
        severite: "a_verifier",
        message: `« ${doc.nom} » semble concerner une autre copropriété (« ${doc.coproprieteDeclaree} »).`,
        documentId: doc.id,
      });
    }
    if (doc.adresseDeclaree && !texteEquivalent(doc.adresseDeclaree, ctx.bien.adresse)) {
      constats.push({
        code: `divergence_adresse_${doc.id}`,
        severite: "a_verifier",
        message: `« ${doc.nom} » semble concerner une autre adresse (« ${doc.adresseDeclaree} »).`,
        documentId: doc.id,
      });
    }
  }

  const documentsInterdits = documents.filter((d) => idsInterdits.has(d.id));

  // 5) Sélection proposée / disponible — croisement strict etatVerification × état checklist
  // (ADR-030) : 'confirme' + 'present' uniquement. Un document 'present'+'non_verifie' (cas le
  // plus fréquent, défaut à l'upload) n'est jamais auto-inclus.
  const idsResolusPresents = new Set(
    checklist.exigences.filter((e) => e.etat === "present" && e.document).map((e) => e.document!.id)
  );
  for (const d of checklist.pvAg.presents) idsResolusPresents.add(d.id);

  const candidats = documents.filter((d) => !idsInterdits.has(d.id));
  const selectionProposee = candidats.filter(
    (d) => d.etatVerification === "confirme" && idsResolusPresents.has(d.id)
  );
  const idsProposes = new Set(selectionProposee.map((d) => d.id));
  const documentsDisponibles = candidats.filter((d) => !idsProposes.has(d.id));

  // 6) État de préparation — jamais une prétention juridique.
  let etatPreparation: EtatPreparationPack;
  if (!ctx.compromisActuel) {
    etatPreparation = "contexte_transactionnel_incomplet";
  } else if (documentsInterdits.length > 0) {
    etatPreparation = "elements_bloquants";
  } else if (constats.some((c) => c.severite === "a_obtenir" || c.severite === "a_verifier")) {
    etatPreparation = "elements_a_traiter";
  } else {
    etatPreparation = "preparation_atlas_complete";
  }

  return { etatPreparation, constats, documentsInterdits, selectionProposee, documentsDisponibles };
}

const EXTENSION_PAR_TYPE_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

function assainirSegmentNom(valeur: string): string {
  const nettoye = valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return nettoye || "Document";
}

// Nom d'export UNIQUEMENT à partir de données déjà structurées — aucune donnée inventée. Ne
// renomme jamais le fichier stocké (ADR-013) : ce nom n'existe que dans l'archive d'export
// (ADR-030). L'année d'un PV AG n'est ajoutée que si dateDocument est renseignée — jamais un
// repli sur creeLe (date d'upload), qui daterait la mauvaise chose.
export function genererNomExport(doc: DocumentBien, index: number, ctx: ContextePackNotaire): string {
  const prefixe = String(index + 1).padStart(2, "0");
  const extension = EXTENSION_PAR_TYPE_MIME[doc.typeMime] ?? "";
  let corps: string;
  if (doc.typeDocument) {
    corps = assainirSegmentNom(LABEL_TYPE_DOCUMENT[doc.typeDocument]);
    if (doc.typeDocument === "cni") {
      if (doc.prospectVendeurId && ctx.prospectVendeurOrigine?.id === doc.prospectVendeurId) {
        corps += `_Vendeur_${assainirSegmentNom(ctx.prospectVendeurOrigine.nom)}`;
      } else if (doc.acquereurId && ctx.acquereur?.id === doc.acquereurId) {
        corps += `_Acquereur_${assainirSegmentNom(ctx.acquereur.nom)}`;
      }
    } else if (doc.typeDocument === "pv_ag" && doc.dateDocument) {
      corps += `_${doc.dateDocument.slice(0, 4)}`;
    }
  } else {
    corps = assainirSegmentNom(doc.nom);
  }
  return `${prefixe}_${corps}${extension}`;
}

// Manifeste — texte brut, uniquement des faits structurés déjà chargés. Les documents 'a_verifier'
// restent listés parmi les éléments à vérifier même s'ils ont été inclus manuellement dans le
// pack : jamais présentés comme validés (ADR-030).
export function genererManifestePackNotaire(
  ctx: ContextePackNotaire,
  pack: PackNotaire,
  documentsSelectionnes: DocumentBien[]
): string {
  const lignes: string[] = [];
  lignes.push(`Dossier de vente — ${ctx.bien.titre}`);
  lignes.push(`${ctx.bien.adresse}, ${ctx.bien.codePostal} ${ctx.bien.ville}`);
  lignes.push("");
  lignes.push(`Contact vendeur principal : ${ctx.prospectVendeurOrigine?.nom ?? "non renseigné"}`);
  lignes.push(`Acquéreur enregistré : ${ctx.acquereur ? `${ctx.acquereur.prenom} ${ctx.acquereur.nom}` : "non renseigné"}`);
  lignes.push(
    `Charge des honoraires : ${ctx.bien.chargeHonoraires ? LABEL_CHARGE_HONORAIRES[ctx.bien.chargeHonoraires] : "non renseignée"}`
  );
  lignes.push("");
  lignes.push(`État de préparation Atlas : ${LABEL_ETAT_PREPARATION_PACK[pack.etatPreparation]}`);
  lignes.push("");
  lignes.push(`Documents inclus (${documentsSelectionnes.length})`);
  documentsSelectionnes.forEach((doc, i) => lignes.push(genererNomExport(doc, i, ctx)));

  const constatsRestants = pack.constats.filter((c) => c.severite !== "information");
  if (constatsRestants.length > 0) {
    lignes.push("");
    lignes.push("Éléments à vérifier / à obtenir (non inclus dans ce pack)");
    for (const c of constatsRestants) lignes.push(`- ${c.message}`);
  }

  return lignes.join("\n");
}
