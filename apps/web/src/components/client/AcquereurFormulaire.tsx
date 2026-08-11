import type { ProfilAcquereur } from "@/types/client";

const inputCls =
  "w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]";
const labelCls = "text-[12px] font-medium text-[#64748b] mb-1 block";

// undefined -> "" (Inconnu) ; jamais "non" par défaut pour une valeur simplement absente.
function triEtat(valeur: boolean | undefined): "" | "oui" | "non" {
  if (valeur === true) return "oui";
  if (valeur === false) return "non";
  return "";
}

// Formulaire partagé création/édition : mêmes champs, mêmes noms, seule la préselection change.
// `acquereur` absent = création ; `acquereur` fourni = édition (préremplissage, champ id caché).
export default function AcquereurFormulaire({
  acquereur,
  action,
  libelleSubmit,
}: {
  acquereur?: ProfilAcquereur;
  action: (formData: FormData) => Promise<void>;
  libelleSubmit: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {acquereur && <input type="hidden" name="id" value={acquereur.id} />}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Prénom *</label>
          <input name="prenom" required defaultValue={acquereur?.prenom ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Nom *</label>
          <input name="nom" required defaultValue={acquereur?.nom ?? ""} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Email *</label>
          <input
            name="email"
            type="email"
            required
            defaultValue={acquereur?.email ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Téléphone *</label>
          <input name="telephone" required defaultValue={acquereur?.telephone ?? ""} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Budget minimum (€) *</label>
          <input
            name="budgetMin"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={acquereur?.budgetMin ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Budget maximum (€) *</label>
          <input
            name="budgetMax"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={acquereur?.budgetMax ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Stade du projet</label>
          <select
            name="stadeProjet"
            defaultValue={acquereur?.stadeProjet ?? "decouverte"}
            className={inputCls}
          >
            <option value="decouverte">Découverte</option>
            <option value="recherche_active">Recherche active</option>
            <option value="offre">En attente d'offre</option>
            <option value="compromis">Compromis</option>
            <option value="acte">Acte</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Date de premier contact *</label>
          <input
            name="datePremiereContact"
            type="date"
            required
            defaultValue={acquereur?.datePremiereContact ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div className="border-t border-[#f1f5f9] pt-4 mt-2">
        <p className="text-[12px] text-[#94a3b8] mb-3">
          Champs optionnels — laissés sur « Inconnu », ils ne seront jamais traités comme une
          réponse négative.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Pièces minimum</label>
            <input
              name="piecesMin"
              type="number"
              min="1"
              step="1"
              defaultValue={acquereur?.piecesMin ?? ""}
              className={inputCls}
              placeholder="Inconnu si vide"
            />
          </div>
          <div>
            <label className={labelCls}>Surface minimum (m²)</label>
            <input
              name="surfaceMin"
              type="number"
              min="0.1"
              step="0.1"
              defaultValue={acquereur?.surfaceMin ?? ""}
              className={inputCls}
              placeholder="Inconnu si vide"
            />
          </div>
          <div>
            <label className={labelCls}>Accessibilité requise</label>
            <select
              name="accessibiliteRequise"
              defaultValue={triEtat(acquereur?.accessibiliteRequise)}
              className={inputCls}
            >
              <option value="">Inconnu</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Parking nécessaire</label>
            <select
              name="necessiteParking"
              defaultValue={triEtat(acquereur?.necessiteParking)}
              className={inputCls}
            >
              <option value="">Inconnu</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Extérieur nécessaire</label>
            <select
              name="necessiteExterieur"
              defaultValue={triEtat(acquereur?.necessiteExterieur)}
              className={inputCls}
            >
              <option value="">Inconnu</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className={labelCls}>Critères (un par ligne)</label>
        <textarea
          name="criteres"
          rows={4}
          defaultValue={(acquereur?.criteres ?? []).join("\n")}
          className={inputCls}
          placeholder={"3 pièces minimum\nLumineux"}
        />
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <textarea name="notes" rows={4} defaultValue={acquereur?.notes ?? ""} className={inputCls} />
      </div>

      <button
        type="submit"
        className="self-start mt-2 text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-4 py-2.5 rounded-lg"
      >
        {libelleSubmit}
      </button>
    </form>
  );
}
