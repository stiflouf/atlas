import SectionTitle from "@/components/ui/SectionTitle";
import { ChevronDown } from "lucide-react";
import type { TransportsProximite, VelibProximite } from "@/types/transports";
import type { EcolesProximite, EtablissementProche } from "@/types/ecoles";
import type { CommercesProximite } from "@/types/commerces";

type Props = {
  transports?: TransportsProximite;
  velib?: VelibProximite;
  ecoles?: EcolesProximite;
  groupesEcoles: { niveau: string; items: EtablissementProche[] }[];
  commerces?: CommercesProximite;
  groupesCommerces: { label: string; items: { nom: string; distanceMetres: number }[] }[];
};

// Fusionne Transports + Vélib' + Écoles + Commerces en un seul bloc UX ("vie pratique autour
// du bien"). Aucune nouvelle donnée ni règle : les listes détaillées sont reprises telles
// quelles, repliées par défaut sous un résumé chiffré minimal (comptages simples, pas de
// sélection ni d'analyse).
export default function VieAutourDuBien({
  transports,
  velib,
  ecoles,
  groupesEcoles,
  commerces,
  groupesCommerces,
}: Props) {
  if (!transports && !velib && !ecoles && !commerces) return null;

  const nbArrets = (transports?.arrets.length ?? 0) + (velib?.stations.length ?? 0);
  const nbEtablissementsScolaires = groupesEcoles.reduce((total, g) => total + g.items.length, 0);
  const nbCategoriesCommerces = groupesCommerces.filter((g) => g.items.length > 0).length;

  return (
    <section className="mb-8">
      <SectionTitle>Vie pratique autour du bien</SectionTitle>
      <p className="text-[13px] text-text-2 mb-3 leading-snug">
        {nbArrets} arrêts de transport · {nbEtablissementsScolaires} établissements scolaires ·{" "}
        {nbCategoriesCommerces} catégories de commerces et services
      </p>

      <details className="group">
        <summary className="cursor-pointer text-[13px] text-accent mb-3 [&::-webkit-details-marker]:hidden list-none flex items-center gap-1">
          Voir le détail
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        </summary>

        <div className="mt-3">
          {/* Transports */}
          {(transports || velib) && (
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                Transports
              </p>
              {transports && transports.arrets.length > 0 && (
                <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border mb-2">
                  {transports.arrets.map((a) => (
                    <p key={a.nom} className="py-3 text-[14px] text-text-1 leading-snug">
                      {(a.modes.join(" / ") || "Arrêt") + " " + a.nom}
                      {a.lignes.length > 0 &&
                        ` — ligne${a.lignes.length > 1 ? "s" : ""} ${a.lignes.join(" / ")}`}
                      {" — "}
                      {a.distanceMetres} m
                    </p>
                  ))}
                </div>
              )}
              {transports && (
                <p className="text-[11px] text-text-3 mb-3">
                  Source : PRIM (Île-de-France Mobilités) · récupéré le{" "}
                  {new Date(transports.recupereLe).toLocaleString("fr-FR")}
                </p>
              )}
              {velib && velib.stations.length > 0 && (
                <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border mb-2">
                  {velib.stations.map((s) => (
                    <p key={s.nom} className="py-3 text-[14px] text-text-1 leading-snug">
                      Station Vélib' {s.nom} — {s.distanceMetres} m
                    </p>
                  ))}
                </div>
              )}
              {velib && (
                <p className="text-[11px] text-text-3">
                  Source : Vélib' Métropole (GBFS) · récupéré le{" "}
                  {new Date(velib.recupereLe).toLocaleString("fr-FR")}
                </p>
              )}
              {transports?.arrets.length === 0 && velib?.stations.length === 0 && (
                <p className="text-[13px] text-text-3">Aucun arrêt ni station Vélib' à moins de 500 m.</p>
              )}
            </div>
          )}

          {/* Écoles */}
          {groupesEcoles.some(({ items }) => items.length > 0) && (
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Écoles</p>
              <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border mb-2">
                {groupesEcoles.flatMap(({ niveau, items }) =>
                  items.map((e) => (
                    <p key={`${niveau}-${e.nom}`} className="py-3 text-[14px] text-text-1 leading-snug">
                      {niveau} {e.nom}
                      {e.statut && ` — ${e.statut}`}
                      {" — "}
                      {e.distanceMetres} m
                    </p>
                  ))
                )}
              </div>
              {ecoles && (
                <p className="text-[11px] text-text-3">
                  Source : Annuaire de l'Éducation Nationale · récupéré le{" "}
                  {new Date(ecoles.recupereLe).toLocaleString("fr-FR")}
                </p>
              )}
            </div>
          )}

          {/* Commerces et services */}
          {groupesCommerces.some(({ items }) => items.length > 0) && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">
                Commerces et services
              </p>
              <div className="bg-surface rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-border mb-2">
                {groupesCommerces.flatMap(({ label, items }) =>
                  items.map((p) => (
                    <p key={`${label}-${p.nom}`} className="py-3 text-[14px] text-text-1 leading-snug">
                      {p.nom} — {label} — {p.distanceMetres} m
                    </p>
                  ))
                )}
              </div>
              {commerces && (
                <p className="text-[11px] text-text-3">
                  Source :{" "}
                  <a href="https://www.openstreetmap.org/copyright" className="underline">
                    © OpenStreetMap contributors
                  </a>{" "}
                  (ODbL) · récupéré le {new Date(commerces.recupereLe).toLocaleString("fr-FR")}
                </p>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
