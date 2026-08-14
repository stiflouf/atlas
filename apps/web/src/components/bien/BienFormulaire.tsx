import type { Bien } from "@/types/bien";

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
// `bien` absent = création (valeurs par défaut) ; `bien` fourni = édition (préremplissage, champ
// id caché pour que la Server Action sache quelle ligne modifier).
export default function BienFormulaire({
  bien,
  action,
  libelleSubmit,
}: {
  bien?: Bien;
  action: (formData: FormData) => Promise<void>;
  libelleSubmit: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {bien && <input type="hidden" name="id" value={bien.id} />}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Référence *</label>
          <input
            name="reference"
            required
            defaultValue={bien?.reference ?? ""}
            className={inputCls}
            placeholder="ATL-2026-001"
          />
        </div>
        <div>
          <label className={labelCls}>Type *</label>
          <select name="type" required defaultValue={bien?.type ?? "appartement"} className={inputCls}>
            <option value="appartement">Appartement</option>
            <option value="maison">Maison</option>
            <option value="studio">Studio</option>
            <option value="loft">Loft</option>
            <option value="local_commercial">Local commercial</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Titre *</label>
        <input
          name="titre"
          required
          defaultValue={bien?.titre ?? ""}
          className={inputCls}
          placeholder="Appartement 3 pièces lumineux"
        />
      </div>

      <div>
        <label className={labelCls}>Adresse *</label>
        <input
          name="adresse"
          required
          defaultValue={bien?.adresse ?? ""}
          className={inputCls}
          placeholder="12 rue de la Paix"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Ville *</label>
          <input name="ville" required defaultValue={bien?.ville ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Code postal *</label>
          <input
            name="codePostal"
            required
            defaultValue={bien?.codePostal ?? ""}
            className={inputCls}
            placeholder="75011"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Surface (m²) *</label>
          <input
            name="surface"
            type="number"
            min="0.1"
            step="0.1"
            required
            defaultValue={bien?.surface ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Pièces *</label>
          <input
            name="pieces"
            type="number"
            min="1"
            step="1"
            required
            defaultValue={bien?.pieces ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Prix (€) *</label>
          <input
            name="prix"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={bien?.prix ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Statut du mandat</label>
          <select name="statutMandat" defaultValue={bien?.statutMandat ?? "actif"} className={inputCls}>
            <option value="actif">Actif</option>
            <option value="suspendu">Suspendu</option>
            <option value="expire">Expiré</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Date du mandat *</label>
          <input
            name="dateMandat"
            type="date"
            required
            defaultValue={bien?.dateMandat ?? ""}
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
            <label className={labelCls}>Étage</label>
            <input
              name="etage"
              type="number"
              min="0"
              step="1"
              defaultValue={bien?.etage ?? ""}
              className={inputCls}
              placeholder="Inconnu si vide"
            />
          </div>
          <div>
            <label className={labelCls}>Ascenseur</label>
            <select name="ascenseur" defaultValue={triEtat(bien?.ascenseur)} className={inputCls}>
              <option value="">Inconnu</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Parking</label>
            <select name="parking" defaultValue={triEtat(bien?.parking)} className={inputCls}>
              <option value="">Inconnu</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Extérieur</label>
            <select name="exterieur" defaultValue={bien?.exterieur ?? ""} className={inputCls}>
              <option value="">Inconnu</option>
              <option value="aucun">Aucun</option>
              <option value="balcon">Balcon</option>
              <option value="terrasse">Terrasse</option>
              <option value="jardin">Jardin</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Copropriété</label>
          <input
            name="nomCopropriete"
            defaultValue={bien?.nomCopropriete ?? ""}
            className={inputCls}
            placeholder="Inconnu si vide"
          />
        </div>
        <div>
          <label className={labelCls}>Charge des honoraires d&apos;agence</label>
          <select name="chargeHonoraires" defaultValue={bien?.chargeHonoraires ?? ""} className={inputCls}>
            <option value="">Non renseignée</option>
            <option value="vendeur">Vendeur</option>
            <option value="acquereur">Acquéreur</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Caractéristiques (une par ligne)</label>
        <textarea
          name="caracteristiques"
          rows={4}
          defaultValue={(bien?.caracteristiques ?? []).join("\n")}
          className={inputCls}
          placeholder={"Plein sud\nCave\nCharges 220€/mois"}
        />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea
          name="description"
          rows={4}
          defaultValue={bien?.description ?? ""}
          className={inputCls}
        />
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
