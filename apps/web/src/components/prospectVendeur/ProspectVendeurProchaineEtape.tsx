import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import type { ProchaineEtape } from "@/lib/prospectVendeurProchaineEtape";
import {
  qualifierProspectVendeurAction,
  enregistrerEstimationProspectVendeurAction,
  planifierRdvEstimationProspectVendeurAction,
  marquerRdvEstimationRealiseProspectVendeurAction,
  proposerMandatProspectVendeurAction,
} from "@/actions/prospectVendeur";

const inputSurNavyCls =
  "w-full bg-white/10 border border-white/25 rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-champagne/50 focus:border-champagne [color-scheme:dark]";
const boutonPrimaireCls =
  "inline-flex items-center justify-center gap-2 text-[14px] font-semibold text-[#2a1c06] bg-champagne hover:brightness-105 transition-all px-5 py-2.5 rounded-lg";
const boutonAppuiCls =
  "inline-flex items-center justify-center gap-2 text-[14px] font-medium text-white/85 border border-white/30 hover:border-white/60 hover:text-white transition-colors px-4 py-2.5 rounded-lg";
const boutonJalonCls =
  "inline-flex items-center justify-center text-[13px] font-medium text-white bg-white/10 border border-white/20 hover:bg-white/20 transition-colors px-3.5 py-2 rounded-lg";

function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Valeur par défaut d'un <input type="datetime-local"> : "YYYY-MM-DDTHH:mm" en heure locale.
// toISOString() donnerait de l'UTC et décalerait l'heure affichée au conseiller.
function valeurDateTimeLocale(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Préremplissage du « rendez-vous tenu » : la date PRÉVUE n'est un défaut utile que si elle est
// déjà passée (le rendez-vous a eu lieu comme prévu, on l'enregistre après coup). La proposer
// alors qu'elle est encore à venir prérempli un champ que la Server Action refuse désormais
// (ADR-027, aucun jalon franchi dans le futur) : on retombe sur l'instant présent, que le
// conseiller corrige si besoin. Confort de saisie uniquement — la règle reste côté serveur.
function defautRendezVousTenu(prospect: ProspectVendeur): string | undefined {
  const candidat = prospect.rdvEstimationRealiseLe ?? prospect.rdvEstimationPrevuLe;
  if (!candidat) return valeurDateTimeLocale(new Date().toISOString());
  return new Date(candidat).getTime() > Date.now()
    ? valeurDateTimeLocale(new Date().toISOString())
    : valeurDateTimeLocale(candidat);
}

// Bande « Prochaine étape » — pièce centrale du cockpit (design validé), seul aplat navy de la
// fiche : une seule action primaire, celle que deriverProchaineEtape a déduite du stade dérivé.
//
// Les SIX commandes de jalon restent toutes atteignables sous « Corriger un jalon » : la saisie
// n'impose aucune séquence (ADR-027, chargerProspectPourJalon), corriger une estimation ou
// replanifier un rendez-vous est un besoin réel. Ce composant ne fait que hiérarchiser des actions
// existantes — il n'ajoute aucune mutation et ne modifie aucune garde.
export default function ProspectVendeurProchaineEtape({
  prospect,
  etape,
}: {
  prospect: ProspectVendeur;
  etape: ProchaineEtape;
}) {
  const idCache = <input type="hidden" name="id" value={prospect.id} />;
  const aujourdHui = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-navy rounded-xl p-5 md:p-6 shadow-[0_3px_14px_rgba(7,26,58,0.18)]">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-start gap-3.5 min-w-0">
          <span className="w-9 h-9 rounded-full bg-white/10 text-champagne flex items-center justify-center shrink-0 mt-0.5">
            <ArrowRight size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-champagne mb-1.5">
              Prochaine étape
            </p>
            <p className="text-[18px] md:text-[19px] font-semibold text-white leading-tight">{etape.titre}</p>
            {etape.action === "marquer_rdv_realise" && prospect.rdvEstimationPrevuLe && (
              <p className="text-[12.5px] text-white/60 mt-1.5">
                Rendez-vous prévu le {formatDateHeure(prospect.rdvEstimationPrevuLe)}
              </p>
            )}
            {etape.action === "signer_mandat" && prospect.mandatProposeLe && (
              <p className="text-[12.5px] text-white/60 mt-1.5">
                Mandat proposé le{" "}
                {new Date(prospect.mandatProposeLe).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · action définitive
              </p>
            )}
          </div>
        </div>

        {/* --- action primaire (+ appui éventuel) --- */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {etape.action === "qualifier" && (
            <form action={qualifierProspectVendeurAction}>
              {idCache}
              <button type="submit" className={boutonPrimaireCls}>
                Marquer comme qualifié
              </button>
            </form>
          )}

          {etape.action === "marquer_rdv_realise" && (
            <details className="relative">
              <summary className={`list-none cursor-pointer select-none ${boutonPrimaireCls}`}>Marquer réalisé</summary>
              <form
                action={marquerRdvEstimationRealiseProspectVendeurAction}
                className="absolute right-0 z-10 mt-2 w-[280px] flex flex-col gap-3 bg-navy-hover border border-white/20 rounded-lg p-3.5 shadow-lg"
              >
                {idCache}
                <label className="text-[12px] font-medium text-white/75">Date et heure du rendez-vous tenu</label>
                <input
                  name="rdvEstimationRealiseLe"
                  type="datetime-local"
                  required
                  defaultValue={defautRendezVousTenu(prospect)}
                  className={inputSurNavyCls}
                />
                <button type="submit" className={boutonJalonCls}>
                  Enregistrer
                </button>
              </form>
            </details>
          )}

          {etape.action === "enregistrer_estimation" && (
            <details className="relative">
              <summary className={`list-none cursor-pointer select-none ${boutonPrimaireCls}`}>
                Enregistrer l&apos;estimation
              </summary>
              <form
                action={enregistrerEstimationProspectVendeurAction}
                className="absolute right-0 z-10 mt-2 w-[280px] flex flex-col gap-3 bg-navy-hover border border-white/20 rounded-lg p-3.5 shadow-lg"
              >
                {idCache}
                <label className="text-[12px] font-medium text-white/75">Montant estimé (€)</label>
                <input name="estimationProposeeCentimes" required placeholder="ex. 350000" className={inputSurNavyCls} />
                <label className="text-[12px] font-medium text-white/75">Date de l&apos;estimation</label>
                <input
                  name="estimationProposeeLe"
                  type="date"
                  required
                  defaultValue={aujourdHui}
                  className={inputSurNavyCls}
                />
                <button type="submit" className={boutonJalonCls}>
                  Enregistrer
                </button>
              </form>
            </details>
          )}

          {etape.action === "proposer_mandat" && (
            <form action={proposerMandatProspectVendeurAction}>
              {idCache}
              <button type="submit" className={boutonPrimaireCls}>
                Marquer le mandat proposé
              </button>
            </form>
          )}

          {/* La conversion vit sur sa page dédiée (/signer-mandat) : formulaire de création de bien
              complet, jamais replié dans cette bande. */}
          {etape.action === "signer_mandat" && (
            <Link href={`/prospects-vendeurs/${prospect.id}/signer-mandat`} className={boutonPrimaireCls}>
              Signer le mandat
            </Link>
          )}

          {etape.appui === "planifier_rdv" && (
            <details className="relative">
              <summary className={`list-none cursor-pointer select-none ${boutonAppuiCls}`}>Planifier le RDV</summary>
              <form
                action={planifierRdvEstimationProspectVendeurAction}
                className="absolute right-0 z-10 mt-2 w-[280px] flex flex-col gap-3 bg-navy-hover border border-white/20 rounded-lg p-3.5 shadow-lg"
              >
                {idCache}
                <label className="text-[12px] font-medium text-white/75">Date et heure prévues</label>
                <input name="rdvEstimationPrevuLe" type="datetime-local" required className={inputSurNavyCls} />
                <button type="submit" className={boutonJalonCls}>
                  Planifier
                </button>
              </form>
            </details>
          )}

          {etape.appui === "mettre_a_jour_estimation" && (
            <details className="relative">
              <summary className={`list-none cursor-pointer select-none ${boutonAppuiCls}`}>
                Mettre à jour l&apos;estimation
              </summary>
              <form
                action={enregistrerEstimationProspectVendeurAction}
                className="absolute right-0 z-10 mt-2 w-[280px] flex flex-col gap-3 bg-navy-hover border border-white/20 rounded-lg p-3.5 shadow-lg"
              >
                {idCache}
                <label className="text-[12px] font-medium text-white/75">Montant estimé (€)</label>
                <input name="estimationProposeeCentimes" required placeholder="ex. 350000" className={inputSurNavyCls} />
                <label className="text-[12px] font-medium text-white/75">Date de l&apos;estimation</label>
                <input
                  name="estimationProposeeLe"
                  type="date"
                  required
                  defaultValue={prospect.estimationProposeeLe ?? aujourdHui}
                  className={inputSurNavyCls}
                />
                <button type="submit" className={boutonJalonCls}>
                  Enregistrer
                </button>
              </form>
            </details>
          )}
        </div>
      </div>

      {/* --- Corriger un jalon : toutes les commandes existantes restent atteignables --- */}
      <details className="mt-4 pt-4 border-t border-white/15">
        <summary className="list-none cursor-pointer select-none text-[13px] font-medium text-white/65 hover:text-white transition-colors">
          Corriger un jalon
        </summary>
        <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {!prospect.qualifieLe && (
            <form action={qualifierProspectVendeurAction} className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-white/75">Qualification</span>
              <button type="submit" className={`${boutonJalonCls} self-start`}>
                Marquer comme qualifié
              </button>
            </form>
          )}

          <form action={planifierRdvEstimationProspectVendeurAction} className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-white/75">
              {prospect.rdvEstimationPrevuLe ? "Replanifier le rendez-vous" : "Planifier le rendez-vous"}
            </label>
            <input name="rdvEstimationPrevuLe" type="datetime-local" required className={inputSurNavyCls} />
            {prospect.rdvEstimationPrevuLe && (
              <span className="text-[11.5px] text-white/50">
                Actuellement prévu le {formatDateHeure(prospect.rdvEstimationPrevuLe)}
              </span>
            )}
            {idCache}
            <button type="submit" className={`${boutonJalonCls} self-start`}>
              Enregistrer
            </button>
          </form>

          <form action={marquerRdvEstimationRealiseProspectVendeurAction} className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-white/75">
              {prospect.rdvEstimationRealiseLe ? "Corriger la date du rendez-vous tenu" : "Marquer le rendez-vous réalisé"}
            </label>
            <input
              name="rdvEstimationRealiseLe"
              type="datetime-local"
              required
              defaultValue={defautRendezVousTenu(prospect)}
              className={inputSurNavyCls}
            />
            {idCache}
            <button type="submit" className={`${boutonJalonCls} self-start`}>
              Enregistrer
            </button>
          </form>

          <form action={enregistrerEstimationProspectVendeurAction} className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-white/75">
              {prospect.estimationProposeeLe ? "Corriger l'estimation" : "Enregistrer une estimation"}
            </label>
            <input
              name="estimationProposeeCentimes"
              required
              placeholder="Montant en € — ex. 350000"
              className={inputSurNavyCls}
            />
            <input
              name="estimationProposeeLe"
              type="date"
              required
              defaultValue={prospect.estimationProposeeLe ?? aujourdHui}
              className={inputSurNavyCls}
            />
            {idCache}
            <button type="submit" className={`${boutonJalonCls} self-start`}>
              Enregistrer
            </button>
          </form>

          {!prospect.mandatProposeLe && (
            <form action={proposerMandatProspectVendeurAction} className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-white/75">Mandat</span>
              <button type="submit" className={`${boutonJalonCls} self-start`}>
                Marquer le mandat proposé
              </button>
            </form>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-white/75">Signature</span>
            <Link href={`/prospects-vendeurs/${prospect.id}/signer-mandat`} className={`${boutonJalonCls} self-start`}>
              Signer le mandat et créer le bien
            </Link>
          </div>
        </div>
        <p className="text-[11.5px] text-white/45 mt-4">
          Aucune séquence n&apos;est imposée : un jalon peut être posé ou corrigé à tout moment.
        </p>
      </details>
    </div>
  );
}
