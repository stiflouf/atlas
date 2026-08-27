import type { ProfilAcquereur } from "@/types/client";

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

// Inconnu ≠ refus (ADR-009, même invariant que le moteur de compatibilité, criteres.ts) :
// l'absence d'une valeur affiche toujours "Non renseigné", jamais "Non" — seule une valeur false
// explicite affiche "Non requis".
function champBooleen(valeur: boolean | undefined): string {
  if (valeur === true) return "Requis";
  if (valeur === false) return "Non requis";
  return "Non renseigné";
}

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-text-3">{label}</span>
      <span className="text-[13px] font-medium text-text-1">{valeur}</span>
    </div>
  );
}

// Rail "Brief d'achat" (design validé, "le brief d'achat") — uniquement les champs structurés
// réellement présents sur ProfilAcquereur (types/client.ts). Aucun type de bien recherché (champ
// inexistant), aucune classification essentiel/secondaire (non plus). "Budget maximum" reprend
// exactement le champ lu par le moteur (criteres.ts, evaluerBudgetMax) — budgetMin n'a aucune
// sémantique dans le moteur, jamais présenté ici comme un seuil de compatibilité.
export default function AcquereurBrief({ client }: { client: ProfilAcquereur }) {
  return (
    <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4 md:p-5">
      <p className="text-[13px] font-semibold text-text-1 mb-3">Brief d&#39;achat</p>
      <div className="flex flex-col gap-2.5">
        <Ligne label="Budget maximum" valeur={formatPrix(client.budgetMax)} />
        <Ligne label="Pièces minimum" valeur={client.piecesMin != null ? String(client.piecesMin) : "Non renseigné"} />
        <Ligne
          label="Surface minimum"
          valeur={client.surfaceMin != null ? `${client.surfaceMin} m²` : "Non renseigné"}
        />
        <Ligne label="Extérieur" valeur={champBooleen(client.necessiteExterieur)} />
        <Ligne label="Parking" valeur={champBooleen(client.necessiteParking)} />
        <Ligne label="Accessibilité (étage / ascenseur)" valeur={champBooleen(client.accessibiliteRequise)} />
      </div>
    </div>
  );
}
