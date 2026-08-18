"use client";

import { useState } from "react";
import { ajouterOffreAction } from "@/actions/offre";
import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";
import type { ProfilAcquereur } from "@/types/client";
import type { Offre } from "@/types/offre";

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(montant);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

type ProprietesCommunes = {
  bienId: string;
  // Tous les comptes rendus du bien (jamais filtrés côté serveur) — le filtrage par acquéreur
  // reste indicatif côté client, la Server Action revalide tout (ADR-019).
  comptesRendus: CompteRenduVisite[];
  // Offres 'en_cours' du bien (toutes, pas seulement celles de la paire sélectionnée) — filtrées
  // ici par acquéreur pour l'avertissement de doublon (ADR-044 §17-21).
  offresEnCoursDuBien: Offre[];
};

// Deux modes : `verrouille: false` (parcours normal depuis la fiche Bien — l'acquéreur reste à
// choisir dans la liste complète, aucune visite source imposée) et `verrouille: true` (parcours
// contextuel depuis une Visite réalisée, ADR-044 — l'acquéreur est un fait déjà structuré de cette
// Visite, non modifiable dans ce parcours ; le conseiller souhaitant une autre paire repasse par le
// parcours normal depuis le Bien, §6 du brief).
type Props =
  | (ProprietesCommunes & { verrouille: false; acquereurs: ProfilAcquereur[] })
  | (ProprietesCommunes & { verrouille: true; acquereur: ProfilAcquereur; compteRenduSourceId?: string });

export default function OffreFormulaire(props: Props) {
  const [acquereurSelectionne, setAcquereurSelectionne] = useState(props.verrouille ? props.acquereur.id : "");
  const [confirmerMalgreExistante, setConfirmerMalgreExistante] = useState(false);

  const acquereurId = props.verrouille ? props.acquereur.id : acquereurSelectionne;
  const compteRenduSourceId = props.verrouille ? props.compteRenduSourceId : undefined;

  const comptesRendusPourAcquereur = acquereurId
    ? props.comptesRendus.filter((cr) => cr.acquereurId === acquereurId && cr.id !== compteRenduSourceId)
    : [];
  const compteRenduSource = compteRenduSourceId
    ? props.comptesRendus.find((cr) => cr.id === compteRenduSourceId)
    : undefined;

  // Avertissement de doublon (ADR-044 §17-21) : une offre 'en_cours' existante pour EXACTEMENT
  // cette paire (bien déjà fixé par le formulaire, acquéreur sélectionné/verrouillé) — jamais un
  // blocage définitif, seulement une confirmation explicite requise avant de créer une seconde
  // offre 'en_cours' pour la même paire. Revalidé côté serveur (ajouterOffreAction) : ce contrôle
  // client n'est qu'un confort, jamais la source de vérité.
  const offresEnCoursPourPaire = acquereurId
    ? props.offresEnCoursDuBien.filter((o) => o.acquereurId === acquereurId)
    : [];
  const soumissionBloqueeParDoublon = offresEnCoursPourPaire.length > 0 && !confirmerMalgreExistante;

  return (
    <form action={ajouterOffreAction} className="flex flex-col gap-2">
      <input type="hidden" name="bienId" value={props.bienId} />

      {props.verrouille ? (
        <div>
          <p className="text-[11px] font-medium text-text-2 mb-1">Acquéreur</p>
          <p className="text-[14px] font-medium text-text-1 bg-surface-muted border border-border rounded-lg px-3 py-2">
            {props.acquereur.prenom} {props.acquereur.nom}
          </p>
          <input type="hidden" name="acquereurId" value={props.acquereur.id} />
        </div>
      ) : (
        <select
          name="acquereurId"
          required
          defaultValue=""
          onChange={(e) => setAcquereurSelectionne(e.target.value)}
          className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        >
          <option value="" disabled>
            Acquéreur
          </option>
          {props.acquereurs.map((a) => (
            <option key={a.id} value={a.id}>
              {a.prenom} {a.nom}
            </option>
          ))}
        </select>
      )}

      {compteRenduSource && (
        <div>
          <p className="text-[11px] font-medium text-text-2 mb-1">Visite associée</p>
          <p className="text-[13px] text-text-1 bg-surface-muted border border-border rounded-lg px-3 py-2">
            {formatDate(compteRenduSource.dateVisite)} — {LABEL_INTERET[compteRenduSource.interet]}
          </p>
          <input type="hidden" name="compteRenduVisiteIds" value={compteRenduSource.id} />
        </div>
      )}

      {acquereurId && (comptesRendusPourAcquereur.length > 0 || !compteRenduSource) && (
        <div>
          <p className="text-[11px] font-medium text-text-2 mb-1">
            {compteRenduSource ? "Autres visites à lier (optionnel)" : "Visites à lier à cette offre (optionnel)"}
          </p>
          {comptesRendusPourAcquereur.length === 0 ? (
            <p className="text-[12px] text-text-3">Aucune visite enregistrée avec cet acquéreur.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {comptesRendusPourAcquereur.map((cr) => (
                <label key={cr.id} className="inline-flex items-center gap-2 text-[13px] text-text-1">
                  <input type="checkbox" name="compteRenduVisiteIds" value={cr.id} />
                  {formatDate(cr.dateVisite)} — {LABEL_INTERET[cr.interet]}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {offresEnCoursPourPaire.length > 0 && (
        <div className="bg-warning-light border border-warning/30 rounded-lg p-3 flex flex-col gap-2">
          <p className="text-[13px] text-warning">
            Une offre en cours existe déjà pour cet acquéreur sur ce bien :
          </p>
          <ul className="flex flex-col gap-0.5">
            {offresEnCoursPourPaire.map((o) => (
              <li key={o.id} className="text-[13px] font-medium text-warning">
                {formatPrix(o.montant)} — {formatDate(o.dateOffre)}
              </li>
            ))}
          </ul>
          <label className="inline-flex items-center gap-2 text-[13px] text-warning">
            <input
              type="checkbox"
              name="confirmerNouvelleOffreMalgreExistante"
              checked={confirmerMalgreExistante}
              onChange={(e) => setConfirmerMalgreExistante(e.target.checked)}
            />
            Créer tout de même une nouvelle offre
          </label>
        </div>
      )}

      <input
        type="number"
        name="montant"
        required
        min={1}
        placeholder="Montant de l'offre (€)"
        className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
      />
      <label className="text-[11px] text-text-3">
        Date de l&apos;offre
        <input
          type="date"
          name="dateOffre"
          required
          className="w-full mt-1 border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </label>
      <label className="text-[11px] text-text-3">
        Date de validité (optionnelle)
        <input
          type="date"
          name="dateValidite"
          className="w-full mt-1 border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </label>
      <button
        type="submit"
        disabled={soumissionBloqueeParDoublon}
        className="self-start text-[13px] font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3.5 py-2 rounded-lg"
      >
        Ajouter l&apos;offre
      </button>
    </form>
  );
}
