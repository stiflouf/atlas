"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { SecteurRecherche } from "@/types/secteurRecherche";
import type { Commune } from "@/types/geocodage";
import { ajouterSecteurRechercheAction, supprimerSecteurRechercheAction } from "@/actions/secteurRecherche";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";

// Formulaire d'ajout séparé (ADR-035) : useActionState pour afficher une erreur actionnable
// inline (IGN indisponible, doublon) — même patron que BrouillonEmailFormulaire/
// envoyerEmailGmailAction (ADR-031-bis), jamais un throw brut qui déclencherait la page d'erreur
// générique de Next.js.
function AjoutSecteur({
  acquereurId,
  onAjoute,
}: {
  acquereurId: string;
  onAjoute: (secteur: SecteurRecherche) => void;
}) {
  const [etat, declencherAjout] = useActionState(ajouterSecteurRechercheAction, { statut: "idle" as const });
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<Commune[]>([]);
  const [selection, setSelection] = useState<Commune | null>(null);
  const [recherchEnCours, setRecherchEnCours] = useState(false);
  const delaiRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dernierSucces = useRef<string | null>(null);

  // Réinitialise la recherche après un ajout confirmé — jamais avant, pour ne pas effacer la
  // sélection pendant que la Server Action est encore en cours (état "pending" de useActionState).
  useEffect(() => {
    if (etat.statut === "succes" && etat.secteur.id !== dernierSucces.current) {
      dernierSucces.current = etat.secteur.id;
      onAjoute(etat.secteur);
      setRecherche("");
      setResultats([]);
      setSelection(null);
    }
  }, [etat, onAjoute]);

  function lancerRecherche(valeur: string) {
    setRecherche(valeur);
    setSelection(null);
    if (delaiRef.current) clearTimeout(delaiRef.current);

    const texte = valeur.trim();
    if (texte.length < 2) {
      setResultats([]);
      setRecherchEnCours(false);
      return;
    }

    setRecherchEnCours(true);
    delaiRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocodage/communes?q=${encodeURIComponent(texte)}`);
        const data = (await res.json()) as { communes: Commune[] };
        setResultats(data.communes ?? []);
      } catch {
        setResultats([]);
      } finally {
        setRecherchEnCours(false);
      }
    }, 300);
  }

  return (
    <div>
      <label className="text-[12px] font-medium text-text-2 mb-1 block">Ajouter un secteur</label>
      <input
        type="text"
        value={recherche}
        onChange={(e) => lancerRecherche(e.target.value)}
        placeholder="Rechercher une commune (ex. Houilles)"
        className={inputCls}
      />

      {recherchEnCours && <p className="text-[12px] text-text-3 mt-1">Recherche…</p>}

      {!recherchEnCours && recherche.trim().length >= 2 && resultats.length === 0 && !selection && (
        <p className="text-[12px] text-text-3 mt-1">Aucune commune trouvée.</p>
      )}

      {resultats.length > 0 && !selection && (
        <div className="mt-1 bg-surface rounded-lg border border-border-md shadow-[0_2px_8px_rgba(0,0,0,0.08)] max-h-56 overflow-y-auto">
          {resultats.map((commune) => (
            <button
              key={commune.citycode}
              type="button"
              onClick={() => {
                setSelection(commune);
                setResultats([]);
              }}
              className="block w-full text-left px-3 py-2 text-[13px] text-text-1 hover:bg-surface-muted transition-colors"
            >
              {commune.nom} ({commune.codePostal}){" "}
              <span className="text-text-3">— {commune.contexte}</span>
            </button>
          ))}
        </div>
      )}

      {selection && (
        <form action={declencherAjout} className="flex flex-wrap items-center gap-2 mt-2">
          <input type="hidden" name="acquereurId" value={acquereurId} />
          <input type="hidden" name="codeInsee" value={selection.citycode} />
          <input type="hidden" name="nomCommune" value={selection.nom} />
          <span className="text-[13px] text-text-1">
            {selection.nom} ({selection.codePostal})
          </span>
          <button
            type="submit"
            className="text-[12px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3 py-1.5 rounded-lg"
          >
            Ajouter
          </button>
          <button
            type="button"
            onClick={() => {
              setSelection(null);
              setRecherche("");
            }}
            className="text-[12px] text-text-3 hover:text-text-2 transition-colors"
          >
            Annuler
          </button>
        </form>
      )}

      {etat.statut === "erreur" && <p className="text-[12px] text-danger mt-2">{etat.message}</p>}
    </div>
  );
}

export default function SecteursRechercheSection({
  acquereurId,
  secteursInitiaux,
  archive,
}: {
  acquereurId: string;
  secteursInitiaux: SecteurRecherche[];
  archive: boolean;
}) {
  const [secteurs, setSecteurs] = useState(secteursInitiaux);

  return (
    <section className="mb-8">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
        Secteurs de recherche
      </p>

      {secteurs.length === 0 ? (
        // Conséquence réelle côté moteur (criteres.ts, evaluerSecteur) — jamais une pénalité
        // inventée : sans secteur, ce critère reste "non_concerne" pour tout bien comparé, il ne
        // bloque ni n'avantage jamais aucun résultat.
        <p className="text-[14px] text-text-3 mb-3">
          Aucun secteur de recherche renseigné — le critère géographique ne sera évalué pour aucun
          bien comparé (ni compatible, ni incompatible) jusqu&#39;à l&#39;ajout d&#39;un secteur.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {secteurs.map((secteur) => (
            <div
              key={secteur.id}
              className="flex items-center justify-between gap-3 bg-surface rounded-lg border border-border px-4 py-2.5"
            >
              <span className="text-[14px] text-text-1">
                {secteur.nomCommune} — {secteur.codePostal}
              </span>
              {!archive && (
                <form action={supprimerSecteurRechercheAction}>
                  <input type="hidden" name="id" value={secteur.id} />
                  <input type="hidden" name="acquereurId" value={acquereurId} />
                  <input type="hidden" name="redirectTo" value={`/clients/${acquereurId}`} />
                  <button
                    type="submit"
                    className="text-[12px] text-text-3 hover:text-danger transition-colors"
                  >
                    Retirer
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {!archive && (
        <AjoutSecteur acquereurId={acquereurId} onAjoute={(secteur) => setSecteurs((s) => [...s, secteur])} />
      )}
    </section>
  );
}
