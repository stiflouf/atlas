"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import {
  CATEGORIES_REPERE_RELATIONNEL,
  LABEL_CATEGORIE_REPERE_RELATIONNEL,
  LABEL_PROVENANCE_REPERE_RELATIONNEL,
  LONGUEUR_MAX_LIBELLE_REPERE,
  PROVENANCES_REPERE_RELATIONNEL,
  type RepereRelationnel,
} from "@/types/repereRelationnel";
import {
  ajouterRepereRelationnelAction,
  archiverRepereRelationnelAction,
  modifierRepereRelationnelAction,
  restaurerRepereRelationnelAction,
  type ResultatActionRepereRelationnel,
} from "@/actions/repereRelationnel";

// VALUE-06 — « Repères relationnels ». Section VOISINE de « Mémoire de la relation », jamais
// fusionnée avec elle : « À retenir » porte les faits structurés du PROJET immobilier (budget,
// secteurs, critères), ce bloc porte ce qui relève de la RELATION. Les confondre ferait croire
// qu'un centre d'intérêt pèse sur la compatibilité d'un bien, ce qui est faux — le moteur
// (ADR-034) ne lit aucun repère.
//
// Aucun nuage de tags, aucune couleur par catégorie, aucun score, aucun « profil » : une liste
// sobre, groupée, que le conseiller relit d'un coup d'œil.

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";
const boutonPrincipalCls =
  "text-[12px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3 py-1.5 rounded-lg";
const boutonDiscretCls = "text-[12px] text-text-3 hover:text-text-2 transition-colors";

// Wording produit, pas juridique : ce que la case autorise, et ce qu'elle n'autorise pas. Le
// second point compte autant que le premier — cocher n'a jamais signifié « utilise ceci partout ».
const AIDE_AUTORISATION = "Même autorisé, ce repère ne sera utilisé que lorsqu'il est pertinent.";
const AIDE_PERTINENCE = "Conservez uniquement des informations utiles à votre relation professionnelle avec ce client.";

function ChampsRepere({ repere }: { repere?: RepereRelationnel }) {
  return (
    <>
      <div>
        <label className={labelCls} htmlFor={`categorie-${repere?.id ?? "nouveau"}`}>
          Catégorie
        </label>
        <select
          id={`categorie-${repere?.id ?? "nouveau"}`}
          name="categorie"
          defaultValue={repere?.categorie ?? "preference_contact"}
          className={inputCls}
        >
          {CATEGORIES_REPERE_RELATIONNEL.map((categorie) => (
            <option key={categorie} value={categorie}>
              {LABEL_CATEGORIE_REPERE_RELATIONNEL[categorie]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor={`libelle-${repere?.id ?? "nouveau"}`}>
          Information à retenir
        </label>
        {/* Placeholder préfixé « Ex. : » et jamais formulé comme une phrase prête à valider : sur la
            demo, un exemple rédigé à l'identique d'un vrai repère a été lu comme une valeur déjà
            saisie, et le repère a été ajouté une seconde fois avec la provenance par défaut.
            `required` n'est qu'un garde-fou de saisie — validerChamps reste la seule sécurité. */}
        <input
          id={`libelle-${repere?.id ?? "nouveau"}`}
          type="text"
          name="libelle"
          defaultValue={repere?.libelle ?? ""}
          maxLength={LONGUEUR_MAX_LIBELLE_REPERE}
          required
          placeholder="Ex. : préfère les échanges par email"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor={`provenance-${repere?.id ?? "nouveau"}`}>
          Provenance
        </label>
        <select
          id={`provenance-${repere?.id ?? "nouveau"}`}
          name="provenance"
          defaultValue={repere?.provenance ?? "saisi_par_le_conseiller"}
          className={inputCls}
        >
          {PROVENANCES_REPERE_RELATIONNEL.map((provenance) => (
            <option key={provenance} value={provenance}>
              {LABEL_PROVENANCE_REPERE_RELATIONNEL[provenance]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-start gap-2 text-[13px] text-text-1">
          {/* Décochée par défaut, toujours : `defaultChecked` ne vaut `true` que si le conseiller
              l'avait déjà explicitement autorisé sur ce repère. */}
          <input
            type="checkbox"
            name="utilisableCommunication"
            defaultChecked={repere?.utilisableCommunication ?? false}
            className="mt-0.5"
          />
          <span>Autoriser DOMIORA à utiliser ce repère pour personnaliser une communication</span>
        </label>
        <p className="text-[11px] text-text-3 mt-1 ml-6">{AIDE_AUTORISATION}</p>
      </div>
    </>
  );
}

function FormulaireModification({
  repere,
  acquereurId,
  onModifie,
  onAnnule,
}: {
  repere: RepereRelationnel;
  acquereurId: string;
  onModifie: (repere: RepereRelationnel) => void;
  onAnnule: () => void;
}) {
  const [etat, declencher] = useActionState<ResultatActionRepereRelationnel | null, FormData>(
    modifierRepereRelationnelAction,
    { statut: "idle" }
  );
  // Rapprochement par `modifieLe` : la valeur courante renvoyée par le serveur remplace la ligne
  // affichée — jamais les valeurs du formulaire, qui ne sont qu'une intention de saisie.
  const dernierSucces = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (etat?.statut === "succes" && etat.repere.modifieLe !== dernierSucces.current) {
      dernierSucces.current = etat.repere.modifieLe;
      onModifie(etat.repere);
    }
  }, [etat, onModifie]);

  return (
    <form action={declencher} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={repere.id} />
      <input type="hidden" name="acquereurId" value={acquereurId} />
      <ChampsRepere repere={repere} />
      <div className="flex items-center gap-3">
        <button type="submit" className={boutonPrincipalCls}>
          Enregistrer
        </button>
        <button type="button" onClick={onAnnule} className={boutonDiscretCls}>
          Annuler
        </button>
      </div>
      {etat?.statut === "erreur" && <p className="text-[12px] text-danger">{etat.message}</p>}
    </form>
  );
}

function FormulaireAjout({
  acquereurId,
  onAjoute,
}: {
  acquereurId: string;
  onAjoute: (repere: RepereRelationnel) => void;
}) {
  const [etat, declencher] = useActionState<ResultatActionRepereRelationnel | null, FormData>(
    ajouterRepereRelationnelAction,
    { statut: "idle" }
  );
  // Le formulaire est remonté après chaque ajout confirmé (clé changée) : les champs non contrôlés
  // reviennent à leurs valeurs par défaut, dont la case d'autorisation DÉCOCHÉE. Aucun état de
  // saisie précédent ne peut ainsi être réutilisé par inadvertance pour le repère suivant.
  const [generation, setGeneration] = useState(0);
  const dernierSucces = useRef<string | null>(null);

  useEffect(() => {
    if (etat?.statut === "succes" && etat.repere.id !== dernierSucces.current) {
      dernierSucces.current = etat.repere.id;
      onAjoute(etat.repere);
      setGeneration((g) => g + 1);
    }
  }, [etat, onAjoute]);

  return (
    <form key={generation} action={declencher} className="flex flex-col gap-3 border-t border-border pt-4">
      <p className="text-[12px] font-medium text-text-2">Ajouter un repère</p>
      <input type="hidden" name="acquereurId" value={acquereurId} />
      <ChampsRepere />
      <div className="flex items-center gap-3">
        <button type="submit" className={boutonPrincipalCls}>
          Ajouter
        </button>
        <p className="text-[11px] text-text-3">{AIDE_PERTINENCE}</p>
      </div>
      {etat?.statut === "erreur" && <p className="text-[12px] text-danger">{etat.message}</p>}
    </form>
  );
}

function LigneRepere({
  repere,
  acquereurId,
  archive,
  onModifie,
}: {
  repere: RepereRelationnel;
  acquereurId: string;
  archive: boolean;
  onModifie: (repere: RepereRelationnel) => void;
}) {
  const [enEdition, setEnEdition] = useState(false);

  if (enEdition) {
    return (
      <div className="bg-surface rounded-lg border border-border-md px-4 py-3">
        <FormulaireModification
          repere={repere}
          acquereurId={acquereurId}
          onModifie={(modifie) => {
            onModifie(modifie);
            setEnEdition(false);
          }}
          onAnnule={() => setEnEdition(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13.5px] text-text-1">{repere.libelle}</p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className="text-[11px] text-text-3">{LABEL_PROVENANCE_REPERE_RELATIONNEL[repere.provenance]}</span>
          {repere.utilisableCommunication && <Badge variant="muted">Utilisable en communication</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {!archive && (
          <button type="button" onClick={() => setEnEdition(true)} className={boutonDiscretCls}>
            Modifier
          </button>
        )}
        <form action={archiverRepereRelationnelAction}>
          <input type="hidden" name="id" value={repere.id} />
          <input type="hidden" name="acquereurId" value={acquereurId} />
          <button type="submit" className={boutonDiscretCls}>
            Archiver
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AcquereurReperesRelationnels({
  acquereurId,
  reperesInitiaux,
  reperesArchives,
  archive,
}: {
  acquereurId: string;
  reperesInitiaux: RepereRelationnel[];
  reperesArchives: RepereRelationnel[];
  archive: boolean;
}) {
  // Ajout et correction mettent à jour la liste sur place (patron SecteursRechercheSection) ;
  // archivage et restauration passent par redirect() et rechargent la page entière.
  const [reperes, setReperes] = useState(reperesInitiaux);

  // Regroupement dans l'ordre canonique des catégories, jamais alphabétique : à l'intérieur d'un
  // groupe, l'ordre est celui, déterministe, rendu par le repository.
  const groupes = CATEGORIES_REPERE_RELATIONNEL.map((categorie) => ({
    categorie,
    reperes: reperes.filter((repere) => repere.categorie === categorie),
  })).filter((groupe) => groupe.reperes.length > 0);

  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Repères relationnels</h2>
      <Card className="p-4 md:p-5 flex flex-col gap-4">
        {groupes.length === 0 ? (
          <p className="text-[13px] text-text-3">
            Aucun repère enregistré. Un repère est une information que vous avez apprise dans la relation et que vous
            souhaitez retenir — jamais une donnée déduite automatiquement.
          </p>
        ) : (
          groupes.map((groupe) => (
            <div key={groupe.categorie} className="[&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-3.5">
              <p className="text-[11px] font-medium text-text-2 mb-1.5">
                {LABEL_CATEGORIE_REPERE_RELATIONNEL[groupe.categorie]}
              </p>
              <div className="flex flex-col gap-2.5">
                {groupe.reperes.map((repere) => (
                  <LigneRepere
                    key={repere.id}
                    repere={repere}
                    acquereurId={acquereurId}
                    archive={archive}
                    onModifie={(modifie) =>
                      setReperes((liste) => liste.map((r) => (r.id === modifie.id ? modifie : r)))
                    }
                  />
                ))}
              </div>
            </div>
          ))
        )}

        {/* Frontière explicite, symétrique de celle de « Mémoire de la relation » : ce bloc ne
            contient jamais de critère du projet immobilier. */}
        <p className="text-[11px] text-text-3">
          Repères de relation — distincts des critères du projet, qui restent les seuls utilisés pour la
          compatibilité des biens.
        </p>

        {reperesArchives.length > 0 && (
          <div className="border-t border-border pt-3.5">
            <p className="text-[11px] font-medium text-text-2 mb-1.5">Archivés</p>
            <div className="flex flex-col gap-2">
              {reperesArchives.map((repere) => (
                <div key={repere.id} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-text-3 line-through">{repere.libelle}</span>
                  <form action={restaurerRepereRelationnelAction}>
                    <input type="hidden" name="id" value={repere.id} />
                    <input type="hidden" name="acquereurId" value={acquereurId} />
                    <button type="submit" className={boutonDiscretCls}>
                      Restaurer
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}

        {!archive && (
          <FormulaireAjout acquereurId={acquereurId} onAjoute={(repere) => setReperes((l) => [...l, repere])} />
        )}
      </Card>
    </section>
  );
}
