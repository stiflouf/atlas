import type { ProspectVendeur } from "@/types/prospectVendeur";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";
const helpCls = "text-[12px] text-text-3 mt-1";

// ADR-027, correction n° 6 : formulaire de conversion en bien — pré-remplit ce qui est déjà connu
// du prospect (jamais la base directement, seulement des valeurs par défaut éditables), mais
// laisse VIDE et obligatoire tout champ jamais connu avant la conversion (reference, titre,
// surface, pièces, date du mandat) — aucun placeholder, aucune valeur inventée. Seul
// adresseBienPotentiel pré-remplit `adresse` : secteurBienPotentiel (approximatif) n'est jamais
// utilisé pour ce champ, un secteur flou ne devient jamais une adresse. `prix` est pré-rempli
// depuis l'estimation proposée (arrondie à l'euro) uniquement comme suggestion éditable, jamais
// une valeur figée.
export default function ProspectVendeurConversionFormulaire({
  prospect,
  action,
}: {
  prospect: ProspectVendeur;
  action: (formData: FormData) => Promise<void>;
}) {
  const prixSuggere =
    prospect.estimationProposeeCentimes !== undefined ? Math.round(prospect.estimationProposeeCentimes / 100) : "";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={prospect.id} />
      {/* Un mandat qui vient d'être signé est actif par définition — pas une valeur inventée. */}
      <input type="hidden" name="statutMandat" value="actif" />

      <p className={helpCls}>
        Les champs déjà connus du prospect sont pré-remplis à titre indicatif — vérifiez-les avant
        de créer le bien. Les autres restent vides et obligatoires.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Référence *</label>
          <input name="reference" required className={inputCls} placeholder="ATL-2026-001" />
        </div>
        <div>
          <label className={labelCls}>Type *</label>
          <select name="type" required defaultValue={prospect.typeBien ?? "appartement"} className={inputCls}>
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
        <input name="titre" required className={inputCls} placeholder="Appartement 3 pièces lumineux" />
      </div>

      <div>
        <label className={labelCls}>Adresse *</label>
        <input
          name="adresse"
          required
          defaultValue={prospect.adresseBienPotentiel ?? ""}
          className={inputCls}
          placeholder="12 rue de la Paix"
        />
        {!prospect.adresseBienPotentiel && prospect.secteurBienPotentiel && (
          <p className={helpCls}>
            Secteur connu : « {prospect.secteurBienPotentiel} » — l&apos;adresse précise reste à
            saisir, un secteur approximatif ne peut pas la remplacer.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Ville *</label>
          <input name="ville" required defaultValue={prospect.ville ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Code postal *</label>
          <input name="codePostal" required defaultValue={prospect.codePostal ?? ""} className={inputCls} placeholder="75011" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Surface (m²) *</label>
          <input name="surface" type="number" min="0.1" step="0.1" required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Pièces *</label>
          <input name="pieces" type="number" min="1" step="1" required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Prix (€) *</label>
          <input name="prix" type="number" min="0" step="1" required defaultValue={prixSuggere} className={inputCls} />
          {prospect.estimationProposeeCentimes !== undefined && (
            <p className={helpCls}>Suggéré depuis l&apos;estimation proposée — à confirmer.</p>
          )}
        </div>
      </div>

      <div>
        <label className={labelCls}>Date du mandat *</label>
        <input name="dateMandat" type="date" required className={inputCls} />
      </div>

      <button
        type="submit"
        className="self-start mt-2 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg"
      >
        Signer le mandat et créer le bien
      </button>
    </form>
  );
}
