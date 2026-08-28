import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ProspectVendeurHero from "@/components/prospectVendeur/ProspectVendeurHero";
import ProspectVendeurProgression from "@/components/prospectVendeur/ProspectVendeurProgression";
import ProspectVendeurProchaineEtape from "@/components/prospectVendeur/ProspectVendeurProchaineEtape";
import ProspectVendeurJournal from "@/components/prospectVendeur/ProspectVendeurJournal";
import ProspectVendeurTaches from "@/components/prospectVendeur/ProspectVendeurTaches";
import ProspectVendeurBienCree from "@/components/prospectVendeur/ProspectVendeurBienCree";
import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import { listerNotesProspectVendeur } from "@/lib/noteProspectVendeurRepository";
import { getTachesPourProspectVendeur } from "@/lib/tacheRepository";
import { getBienById } from "@/lib/bienRepository";
import { deriverStatutProspectVendeur } from "@/types/prospectVendeur";
import { deriverStatutTache } from "@/types/tache";
import { LABEL_ORIGINE_LEAD } from "@/types/origineLead";
import {
  MOTIFS_PERTE_PROSPECT_VENDEUR,
  LABEL_MOTIF_PERTE_PROSPECT_VENDEUR,
} from "@/types/motifPerteProspectVendeur";
import { TYPES_NOTE_INTERACTION } from "@/types/noteProspectVendeur";
import {
  deriverJournalProspectVendeur,
  deriverParcoursProspectVendeur,
  joursDepuisDernierEchange,
} from "@/lib/prospectVendeurParcours";
import { deriverProchaineEtape } from "@/lib/prospectVendeurProchaineEtape";
import {
  archiverProspectVendeurAction,
  desarchiverProspectVendeurAction,
  marquerProspectVendeurPerduAction,
} from "@/actions/prospectVendeur";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tacheTerminee?: string }>;
};

// Cockpit de prise de mandat (design validé) — un prospect vendeur est une PERSONNE, un PROJET DE
// VENTE et une PROGRESSION vers un mandat. La page répond dans cet ordre à trois questions : où en
// est-on (hero + rail de progression), que faire maintenant (bande navy, action unique dérivée du
// stade), et que s'est-il passé (journal). Les commandes de jalon existantes restent toutes
// atteignables sous « Corriger un jalon » — aucune séquence n'est imposée à la saisie (ADR-027).
//
// Aucune mutation n'a été ajoutée par ce chantier : la page ne fait que réordonner et hiérarchiser
// des Server Actions existantes, avec leurs gardes existantes.
export default async function FicheProspectVendeur({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tacheTerminee } = await searchParams;
  const prospect = await getProspectVendeurById(id);
  if (!prospect) notFound();

  const notes = await listerNotesProspectVendeur(prospect.id);
  const taches = await getTachesPourProspectVendeur(prospect.id);
  const tachesOuvertes = taches.filter((t) => deriverStatutTache(t) === "a_faire");
  const tachesTerminees = taches.filter((t) => deriverStatutTache(t) === "terminee");
  const tacheTermineeConfirmee = tachesTerminees.find((t) => t.id === tacheTerminee);

  const statut = deriverStatutProspectVendeur(prospect);
  const parcours = deriverParcoursProspectVendeur(prospect);
  const journal = deriverJournalProspectVendeur(prospect, notes);
  const prochaineEtape = deriverProchaineEtape(prospect);

  // Le bien n'est chargé que lorsqu'il existe réellement (bienId n'est posé qu'à la signature du
  // mandat, ADR-027) — jamais un lien construit à l'aveugle vers une fiche inexistante.
  const bienCree = prospect.bienId ? await getBienById(prospect.bienId) : undefined;

  const jours = joursDepuisDernierEchange(prospect);
  const nombreEchanges = notes.filter((n) => TYPES_NOTE_INTERACTION.includes(n.type)).length;
  const nombreNotesInternes = notes.length - nombreEchanges;

  // « À compléter » ne liste que des champs réellement éditables par le formulaire existant
  // (NouveauProspectVendeur) — jamais un score de complétion, jamais un champ inexistant.
  const champsACompleter: string[] = [];
  if (!prospect.email && !prospect.telephone) champsACompleter.push("Téléphone ou email");
  if (!prospect.adresseBienPotentiel) champsACompleter.push("Adresse précise du bien");
  if (!prospect.typeBien) champsACompleter.push("Type de bien");
  if (!prospect.origineLead) champsACompleter.push("Origine du lead");

  const enCours = statut !== "perdu" && statut !== "mandat_signe";

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <Link
        href="/prospects-vendeurs"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Prospects vendeurs
      </Link>

      <div className="mb-4">
        <div className="bg-surface border border-border rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] overflow-hidden">
          <ProspectVendeurHero prospect={prospect} />
          <ProspectVendeurProgression jalons={parcours} />
        </div>
      </div>

      {/* Bande navy réservée à la prochaine transition — absente dès qu'il n'y en a plus, jamais un
          bandeau vide ni un bouton mort. */}
      {prochaineEtape && (
        <div className="mb-6">
          <ProspectVendeurProchaineEtape prospect={prospect} etape={prochaineEtape} />
        </div>
      )}

      {bienCree && (
        <div className="mb-6">
          <ProspectVendeurBienCree bien={bienCree} />
        </div>
      )}

      {/* Mandat signé sans bien résolvable : cas anormal (bienId pointe vers un bien introuvable).
          Un constat honnête plutôt qu'un silence ou un lien cassé. */}
      {statut === "mandat_signe" && !bienCree && (
        <div className="mb-6 bg-warning-light border border-warning/30 rounded-xl p-4">
          <p className="text-[13px] text-warning">
            Mandat signé le {prospect.mandatSigneLe ? formatDate(prospect.mandatSigneLe) : "—"} — le bien associé est
            introuvable.
          </p>
        </div>
      )}

      {statut === "perdu" && (
        <div className="mb-6 bg-danger-light border border-danger/30 rounded-xl p-4">
          <p className="text-[14px] font-medium text-danger">
            {prospect.motifPerte ? LABEL_MOTIF_PERTE_PROSPECT_VENDEUR[prospect.motifPerte] : "Opportunité perdue"}
          </p>
          {prospect.datePerte && (
            <p className="text-[13px] text-danger mt-0.5">Perdue le {formatDate(prospect.datePerte)}</p>
          )}
          <p className="text-[12px] text-danger/80 mt-1.5">
            Le parcours reste consultable ; aucun jalon ne peut plus être posé.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_316px] gap-6 items-start">
        {/* Corps — le parcours et la relation sont le cœur de cette fiche. */}
        <div className="flex flex-col gap-6 min-w-0">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Parcours et échanges</p>
            <ProspectVendeurJournal prospectId={prospect.id} entrees={journal} />
          </section>
        </div>

        {/* Rail — contexte de travail, puis sortie du pipeline, hors du flux principal. */}
        <div className="flex flex-col gap-5 min-w-0">
          <ProspectVendeurTaches
            prospectId={prospect.id}
            tachesOuvertes={tachesOuvertes}
            tachesTerminees={tachesTerminees}
            tacheTerminee={tacheTermineeConfirmee}
          />

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Relation</p>
            <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-text-2">Dernier échange</span>
                <span className="text-[12.5px] font-medium text-text-1">
                  {prospect.dernierContactLe ? `il y a ${jours} j` : "jamais"}
                </span>
              </div>
              {/* Nombre de notes RÉELLEMENT enregistrées — jamais un nombre de relances, jamais une
                  activité détectée automatiquement : Atlas ne détecte aucun appel ni email entrant. */}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-text-2">Échanges enregistrés</span>
                <span className="text-[12.5px] font-medium text-text-1">{nombreEchanges}</span>
              </div>
              {nombreNotesInternes > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-text-2">Notes internes</span>
                  <span className="text-[12.5px] font-medium text-text-1">{nombreNotesInternes}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-text-2">Origine</span>
                <span className="text-[12.5px] font-medium text-text-1">
                  {prospect.origineLead ? LABEL_ORIGINE_LEAD[prospect.origineLead] : "Non déterminée"}
                </span>
              </div>
              {statut === "mandat_signe" && prospect.mandatSigneLe && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-text-2">Du premier contact à la signature</span>
                  <span className="text-[12.5px] font-medium text-text-1">
                    {Math.floor(
                      (new Date(prospect.mandatSigneLe).getTime() - new Date(prospect.creeLe).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )}{" "}
                    j
                  </span>
                </div>
              )}
            </div>
          </section>

          {champsACompleter.length > 0 && enCours && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">À compléter</p>
              <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4 flex flex-col gap-1.5">
                {champsACompleter.map((champ) => (
                  <p key={champ} className="text-[12.5px] text-text-2">
                    {champ}
                  </p>
                ))}
                <Link
                  href={`/prospects-vendeurs/${prospect.id}/modifier`}
                  className="text-[12.5px] font-medium text-accent hover:text-accent-hover transition-colors mt-1"
                >
                  Compléter la fiche →
                </Link>
              </div>
            </section>
          )}

          {/* Sortie du pipeline — visuellement détachée : ce ne sont pas des étapes. */}
          <div className="border-t border-dashed border-border-md pt-4 flex flex-col gap-2">
            {statut !== "mandat_signe" && statut !== "perdu" && (
              <details>
                <summary className="list-none cursor-pointer select-none text-[13px] font-medium text-text-2 hover:text-danger transition-colors">
                  Marquer comme perdu
                </summary>
                <form action={marquerProspectVendeurPerduAction} className="flex flex-col gap-2.5 mt-2.5">
                  <input type="hidden" name="id" value={prospect.id} />
                  <select name="motifPerte" defaultValue="" required className={inputCls}>
                    <option value="" disabled>
                      Motif
                    </option>
                    {MOTIFS_PERTE_PROSPECT_VENDEUR.map((m) => (
                      <option key={m} value={m}>
                        {LABEL_MOTIF_PERTE_PROSPECT_VENDEUR[m]}
                      </option>
                    ))}
                  </select>
                  <input
                    name="datePerte"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputCls}
                  />
                  <button
                    type="submit"
                    className="self-start text-[12.5px] font-medium text-danger bg-surface border border-border-md hover:border-danger transition-colors px-3 py-1.5 rounded-lg"
                  >
                    Confirmer la perte
                  </button>
                </form>
              </details>
            )}

            <form action={prospect.archiveLe ? desarchiverProspectVendeurAction : archiverProspectVendeurAction}>
              <input type="hidden" name="id" value={prospect.id} />
              <button
                type="submit"
                className="text-[12.5px] font-medium text-text-3 hover:text-text-1 transition-colors"
              >
                {prospect.archiveLe ? "Désarchiver la fiche" : "Archiver la fiche"}
              </button>
            </form>

            {statut === "mandat_signe" && (
              <p className="text-[11.5px] text-text-3">Une signature ne peut pas être annulée.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
