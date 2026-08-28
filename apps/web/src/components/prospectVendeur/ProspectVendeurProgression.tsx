import { Check } from "lucide-react";
import type { JalonParcours } from "@/lib/prospectVendeurParcours";

function formatDateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const COULEUR_BARRE: Record<JalonParcours["etat"], string> = {
  passe: "bg-success",
  actuel: "bg-champagne",
  futur: "bg-border",
};

// Rail de progression du cockpit (design validé) — remplace la pile verticale de sept boutons de
// jalon par une lecture d'un coup d'œil. Purement présentationnel : il n'ordonne rien lui-même,
// deriverParcoursProspectVendeur lui passe déjà les six segments dans l'ordre réel du code.
//
// Deux rendus, un seul jeu de données : segments détaillés à partir de md (chaque jalon porte son
// libellé et sa date), six barres muettes + le libellé du seul stade courant en dessous —
// une pile de six lignes serait ingérable à 390 px.
export default function ProspectVendeurProgression({ jalons }: { jalons: JalonParcours[] }) {
  const indexActuel = jalons.findIndex((j) => j.etat === "actuel");
  const jalonActuel = indexActuel >= 0 ? jalons[indexActuel] : undefined;
  const nombreFranchis = jalons.filter((j) => j.etat === "passe" || j.etat === "actuel").length;

  return (
    <div className="border-t border-border px-5 md:px-6 py-3.5">
      {/* --- mobile : barres + stade courant --- */}
      <div className="md:hidden flex flex-col gap-2">
        <div className="flex gap-1" role="img" aria-label={`Progression : ${nombreFranchis} jalon(s) sur ${jalons.length}`}>
          {jalons.map((jalon) => (
            <span key={jalon.cle} className={`flex-1 h-1 rounded-sm ${COULEUR_BARRE[jalon.etat]}`} />
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[12.5px] font-semibold text-text-1">
            {jalonActuel
              ? `Étape ${indexActuel + 1} sur ${jalons.length} — ${jalonActuel.libelle}`
              : `${nombreFranchis} jalon${nombreFranchis > 1 ? "s" : ""} sur ${jalons.length}`}
          </p>
          {jalonActuel?.date && (
            <span className="text-[11.5px] text-text-3 shrink-0">
              {jalonActuel.previsionnel ? "prévu " : ""}
              {formatDateCourte(jalonActuel.date)}
            </span>
          )}
        </div>
      </div>

      {/* --- desktop / laptop : segments détaillés --- */}
      <div className="hidden md:flex gap-1.5">
        {jalons.map((jalon) => (
          <div key={jalon.cle} className="flex-1 min-w-0 flex flex-col gap-1.5">
            <span
              className={`h-1 rounded-sm ${COULEUR_BARRE[jalon.etat]} ${
                jalon.etat === "actuel" ? "ring-2 ring-champagne-light" : ""
              }`}
            />
            <span
              className={`text-[11.5px] leading-tight truncate flex items-center gap-1 ${
                jalon.etat === "actuel"
                  ? "text-text-1 font-semibold"
                  : jalon.etat === "passe"
                    ? "text-text-2 font-medium"
                    : "text-text-3"
              }`}
            >
              {/* Même marqueur que les tâches terminées (validé rc6) : cercle plein + coche claire,
                  jamais une case qui laisserait croire à un contrôle cliquable. */}
              {jalon.etat === "passe" && (
                <span
                  role="img"
                  aria-label="Jalon franchi"
                  className="w-3 h-3 rounded-full bg-success text-surface flex items-center justify-center shrink-0"
                >
                  <Check size={8} strokeWidth={4} />
                </span>
              )}
              {jalon.libelle}
            </span>
            <span className="text-[10.5px] text-text-3 leading-tight tabular-nums">
              {jalon.date ? (
                <>
                  {jalon.previsionnel && "prévu "}
                  {formatDateCourte(jalon.date)}
                </>
              ) : (
                // Jamais une date fabriquée pour remplir la colonne : un jalon non franchi et non
                // planifié n'a aucune date, et le dit.
                "—"
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
