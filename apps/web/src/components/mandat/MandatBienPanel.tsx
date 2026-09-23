import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MandatFaitsChamps from "@/components/mandat/MandatFaitsChamps";
import {
  ajouterPartieMandatAction,
  enregistrerMandatExistantAction,
  modifierMandatAction,
  modifierRolePartieMandatAction,
  resilierMandatAction,
  retirerPartieMandatAction,
} from "@/actions/mandat";
import { statutMandatEffectif, type PresentationMandatBien } from "@/lib/presentationMandatBien";
import { nomComplet } from "@/lib/identite/nomPersonne";
import { LABEL_STATUT_MANDAT_DERIVE, LABEL_TYPE_MANDAT, type MandatHistorique, type StatutMandatDerive } from "@/types/mandat";
import { LABEL_ROLE_PARTIE_MANDAT, type PartieMandatDetail } from "@/types/partieMandat";
import type { Contact } from "@/types/contact";

// ADR-060 — LE bloc Mandat de la fiche Bien (lot MANDATE_CANONICAL_UI_V1), présentationnel : il
// reçoit la présentation déjà tranchée par `chargerPresentationMandatBien` (canonique / legacy /
// aucun) et ne relit JAMAIS `biens.statut_mandat` ni `date_mandat` lui-même — la précédence est
// décidée une seule fois, côté read model. Trois états, un seul composant : aucun `if (mandat…)`
// dispersé dans d'autres écrans.
//
// Formulaires natifs + Server Actions, comme partout (ADR-048) ; les actions secondaires sont
// repliées sous <details>, même patron que les actions non-commerciales du bandeau. Chaque geste
// destructif (résilier, retirer) exige une confirmation explicite et porte un libellé, jamais une
// icône seule.

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";
const resumeCls = "cursor-pointer text-[12.5px] font-medium text-accent hover:text-action-primary-hover select-none";

const VARIANTE_STATUT: Record<StatutMandatDerive, "success" | "warning" | "danger" | "muted"> = {
  actif: "success",
  a_venir: "warning",
  expire: "danger",
  resilie: "muted",
};

// Refus rendus par les actions (`?mandat=`), affichés tels quels — jamais avalés.
const MESSAGES_REFUS: Record<string, string> = {
  resilie: "Ce mandat est résilié : il ne se modifie plus.",
  deja_resilie: "Ce mandat est déjà résilié.",
  remplace: "Ce mandat a été remplacé : il ne se modifie plus.",
  dates_incoherentes: "Dates incohérentes : le terme ne peut pas précéder la prise d'effet, et l'exclusivité doit rester dans la période.",
  date_incoherente: "La date de résiliation ne peut pas précéder la prise d'effet du mandat.",
  mandat_canonique_existant: "Un mandat est déjà enregistré pour ce bien.",
  deja_partie: "Cette personne est déjà partie au mandat. Modifiez son rôle plutôt que de l'ajouter à nouveau.",
  contact_introuvable: "Ce contact est introuvable.",
  contact_fusionne: "Ce contact a été fusionné dans un autre : choisissez le contact conservé.",
  // DEMO_UX_HARDENING_V1 — refus de SAISIE (date mal formée, type de mandat absent) routé par
  // actions/mandat.ts dans ce même canal, plutôt qu'une page d'erreur.
  saisie_invalide: "Saisie incomplète ou mal formée : vérifiez le type de mandat et les dates (AAAA-MM-JJ).",
};

// Date ISO (AAAA-MM-JJ) -> « 1 janvier 2026 », en UTC pour ne jamais glisser d'un jour.
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function Champ({ libelle, valeur }: { libelle: string; valeur?: string }) {
  return (
    <div className="min-w-[120px]">
      <p className="text-[11px] text-text-muted mb-1">{libelle}</p>
      <p className={`text-[13px] font-medium ${valeur ? "text-text-primary" : "text-text-muted"}`}>{valeur ?? "Non renseigné"}</p>
    </div>
  );
}

type Props = {
  bienId: string;
  presentation: PresentationMandatBien;
  refus?: string;
  // Recherche de contact pour « Ajouter une personne » (formulaire GET, paramètre `qMandat`).
  qContact?: string;
  candidatsContact: Contact[];
};

export default function MandatBienPanel({ bienId, presentation, refus, qContact, candidatsContact }: Props) {
  const effectif = statutMandatEffectif(presentation);
  return (
    <section
      id="mandat"
      className="bg-surface border border-border-subtle rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4 md:p-5 scroll-mt-4"
    >
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <p className="text-[15px] font-semibold text-text-primary">Mandat</p>
        <Badge variant={effectif.variante}>{effectif.libelle}</Badge>
      </div>

      {refus && (
        <p role="alert" className="text-[12.5px] text-danger mb-3">
          {MESSAGES_REFUS[refus] ?? "L'opération n'a pas pu être effectuée."}
        </p>
      )}

      {presentation.mode === "canonique" && (
        <MandatCanonique bienId={bienId} presentation={presentation} qContact={qContact} candidatsContact={candidatsContact} />
      )}
      {presentation.mode === "legacy" && (
        <MandatLegacy bienId={bienId} dateLegacy={presentation.dateMandat} />
      )}
      {presentation.mode === "aucun" && <MandatLegacy bienId={bienId} />}
    </section>
  );
}

function MandatCanonique({
  bienId,
  presentation,
  qContact,
  candidatsContact,
}: {
  bienId: string;
  presentation: Extract<PresentationMandatBien, { mode: "canonique" }>;
  qContact?: string;
  candidatsContact: Contact[];
}) {
  const courant = presentation.mandatCourant;
  return (
    <div className="flex flex-col gap-5">
      {courant ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">Mandat actuel</p>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <Champ libelle="Type" valeur={courant.type ? LABEL_TYPE_MANDAT[courant.type] : undefined} />
            <Champ libelle="Numéro" valeur={courant.numero} />
            <Champ libelle="Prise d'effet" valeur={formatDate(courant.dateDebut)} />
            <Champ libelle="Terme" valeur={courant.dateFin ? formatDate(courant.dateFin) : undefined} />
            <Champ libelle="Exclusivité jusqu'au" valeur={courant.exclusiviteJusquAu ? formatDate(courant.exclusiviteJusquAu) : undefined} />
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
            <details className="group">
              <summary className={resumeCls}>Modifier le mandat</summary>
              <form action={modifierMandatAction} className="flex flex-col gap-4 mt-3 border border-border-subtle rounded-lg p-4">
                <input type="hidden" name="mandatId" value={courant.id} />
                <input type="hidden" name="bienId" value={bienId} />
                <MandatFaitsChamps
                  valeurs={{ type: courant.type, numero: courant.numero, dateFin: courant.dateFin, exclusiviteJusquAu: courant.exclusiviteJusquAu }}
                />
                <p className="text-[12px] text-text-3">
                  Prise d&apos;effet du {formatDate(courant.dateDebut)} — elle ne se modifie pas ici.
                </p>
                <div>
                  <Button type="submit" variant="primary" size="sm">Enregistrer les modifications</Button>
                </div>
              </form>
            </details>

            <details className="group">
              <summary className={resumeCls}>Résilier le mandat</summary>
              <form action={resilierMandatAction} className="flex flex-col gap-4 mt-3 border border-border-subtle rounded-lg p-4">
                <input type="hidden" name="mandatId" value={courant.id} />
                <input type="hidden" name="bienId" value={bienId} />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={`resilieLe-${courant.id}`} className={labelCls}>Date de résiliation *</label>
                    <input id={`resilieLe-${courant.id}`} name="resilieLe" type="date" required min={courant.dateDebut} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor={`motif-${courant.id}`} className={labelCls}>Motif</label>
                    <input id={`motif-${courant.id}`} name="motifResiliation" className={inputCls} placeholder="Facultatif" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[12.5px] text-text-2">
                  <input type="checkbox" name="confirmation" required />
                  Je confirme la résiliation de ce mandat. Le terme prévu n&apos;est pas modifié ; le mandat reste dans l&apos;historique.
                </label>
                <div>
                  <Button type="submit" variant="destructive" size="sm">Résilier le mandat</Button>
                </div>
              </form>
            </details>
          </div>

          <Parties bienId={bienId} mandatId={courant.id} parties={presentation.parties} qContact={qContact} candidatsContact={candidatsContact} />
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">Aucun mandat en cours pour ce bien.</p>
      )}

      <Historique historique={presentation.historique} courantId={courant?.id} />
    </div>
  );
}

function Parties({
  bienId,
  mandatId,
  parties,
  qContact,
  candidatsContact,
}: {
  bienId: string;
  mandatId: string;
  parties: PartieMandatDetail[];
  qContact?: string;
  candidatsContact: Contact[];
}) {
  const mandants = parties.filter((p) => p.role === "mandant");
  const representants = parties.filter((p) => p.role === "representant");
  return (
    <div className="mt-5 pt-4 border-t border-border-subtle">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <ListeParties titre="Mandants" parties={mandants} bienId={bienId} vide="Aucun mandant renseigné" />
        <ListeParties titre="Représentants" parties={representants} bienId={bienId} vide="Aucun représentant" />
      </div>

      <details className="mt-4" open={qContact !== undefined}>
        <summary className={resumeCls}>Ajouter une personne au mandat</summary>
        <div className="flex flex-col gap-3 mt-3 border border-dashed border-border-md rounded-lg p-4">
          <form method="GET" action={`/biens/${bienId}`} className="flex items-center gap-2">
            <label htmlFor="qMandat" className="sr-only">Rechercher un contact</label>
            <input
              id="qMandat"
              type="text"
              name="qMandat"
              defaultValue={qContact ?? ""}
              placeholder="Rechercher un contact (nom, email, téléphone)"
              className={`${inputCls} flex-1`}
            />
            <Button type="submit" variant="secondary" size="sm">Rechercher</Button>
          </form>
          {qContact && candidatsContact.length === 0 && (
            <p className="text-[12.5px] text-text-3">Aucun contact ne correspond à cette recherche.</p>
          )}
          {candidatsContact.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {candidatsContact.map((candidat) => (
                <li key={candidat.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] text-text-1">{nomComplet(candidat)}</p>
                    <p className="text-[12px] text-text-3">
                      {[candidat.email, candidat.telephone].filter(Boolean).join(" · ") || "Aucune coordonnée"}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <form action={ajouterPartieMandatAction}>
                      <input type="hidden" name="mandatId" value={mandatId} />
                      <input type="hidden" name="bienId" value={bienId} />
                      <input type="hidden" name="contactId" value={candidat.id} />
                      <input type="hidden" name="role" value="mandant" />
                      <Button type="submit" variant="secondary" size="sm">Ajouter comme mandant</Button>
                    </form>
                    <form action={ajouterPartieMandatAction}>
                      <input type="hidden" name="mandatId" value={mandatId} />
                      <input type="hidden" name="bienId" value={bienId} />
                      <input type="hidden" name="contactId" value={candidat.id} />
                      <input type="hidden" name="role" value="representant" />
                      <Button type="submit" variant="ghost" size="sm">Ajouter comme représentant</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

function ListeParties({ titre, parties, bienId, vide }: { titre: string; parties: PartieMandatDetail[]; bienId: string; vide: string }) {
  return (
    <div className="min-w-[200px]">
      <p className="text-[11px] text-text-muted mb-1.5">{titre}</p>
      {parties.length === 0 ? (
        <p className="text-[13px] text-text-muted">{vide}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {parties.map((partie) => {
            const autreRole = partie.role === "mandant" ? "representant" : "mandant";
            return (
              <li key={partie.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/contacts/${partie.contact.id}`} className="text-[13px] font-medium text-action-primary hover:text-action-primary-hover">
                  {nomComplet(partie.contact)}
                </Link>
                <Badge variant="muted">{LABEL_ROLE_PARTIE_MANDAT[partie.role]}</Badge>
                <form action={modifierRolePartieMandatAction}>
                  <input type="hidden" name="partieId" value={partie.id} />
                  <input type="hidden" name="bienId" value={bienId} />
                  <input type="hidden" name="role" value={autreRole} />
                  <Button type="submit" variant="ghost" size="sm">
                    Passer {LABEL_ROLE_PARTIE_MANDAT[autreRole].toLowerCase()}
                  </Button>
                </form>
                <details>
                  <summary className="cursor-pointer text-[12px] text-text-secondary hover:text-status-danger select-none">Retirer du mandat</summary>
                  <form action={retirerPartieMandatAction} className="mt-1">
                    <input type="hidden" name="partieId" value={partie.id} />
                    <input type="hidden" name="bienId" value={bienId} />
                    <Button type="submit" variant="destructive" size="sm">Confirmer le retrait de {nomComplet(partie.contact)}</Button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Historique({ historique, courantId }: { historique: MandatHistorique[]; courantId?: string }) {
  // Ordre antichronologique de prise d'effet : le plus récent en tête, comme on lit un historique.
  const lignes = [...historique].reverse();
  return (
    <div className={courantId ? "pt-4 border-t border-border-subtle" : ""}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Historique des mandats</p>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {lignes.map((mandat) => (
          <li key={mandat.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12.5px] text-text-secondary">
            <Badge variant={VARIANTE_STATUT[mandat.statut]}>{LABEL_STATUT_MANDAT_DERIVE[mandat.statut]}</Badge>
            <span className="font-medium text-text-primary">{mandat.type ? LABEL_TYPE_MANDAT[mandat.type] : "Type non renseigné"}</span>
            {mandat.numero && <span>n° {mandat.numero}</span>}
            <span>
              du {formatDate(mandat.dateDebut)}
              {mandat.dateFin ? ` au ${formatDate(mandat.dateFin)}` : ", sans terme renseigné"}
            </span>
            {mandat.resilieLe && (
              <span>
                — résilié le {formatDate(mandat.resilieLe)}
                {mandat.motifResiliation ? ` (${mandat.motifResiliation})` : ""}
              </span>
            )}
            {mandat.remplaceParId && <span className="text-text-muted">— remplacé</span>}
            {mandat.id === courantId && <Badge variant="accent">Actuel</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Legacy-only (ou aucun mandat exploitable) : les colonnes historiques du bien restent la vérité
// affichée, et le geste « Enregistrer le mandat existant » (ADR-060 §15) fait basculer le bien sur
// le canonique. `date_mandat` ne sert qu'à PRÉREMPLIR la prise d'effet : l'humain la soumet.
function MandatLegacy({ bienId, dateLegacy }: { bienId: string; dateLegacy?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <Champ libelle="Date du mandat" valeur={dateLegacy ? formatDate(dateLegacy) : undefined} />
      </div>
      <p className="text-[12.5px] text-text-3">
        Ce bien porte un mandat saisi avant le suivi contractuel détaillé. Enregistrez-le pour suivre son type, son terme, sa résiliation et ses mandants.
      </p>
      <details>
        <summary className={resumeCls}>Enregistrer le mandat existant</summary>
        <form action={enregistrerMandatExistantAction} className="flex flex-col gap-4 mt-3 border border-border-subtle rounded-lg p-4">
          <input type="hidden" name="bienId" value={bienId} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dateDebutMandat" className={labelCls}>Date de prise d&apos;effet *</label>
              <input id="dateDebutMandat" name="dateDebutMandat" type="date" required defaultValue={dateLegacy ?? ""} className={inputCls} />
              {dateLegacy && <p className="text-[12px] text-text-3 mt-1">Préremplie depuis la date de mandat du bien — vérifiez-la avant d&apos;enregistrer.</p>}
            </div>
          </div>
          <MandatFaitsChamps />
          <div>
            <Button type="submit" variant="primary" size="sm">Enregistrer le mandat</Button>
          </div>
        </form>
      </details>
    </div>
  );
}
