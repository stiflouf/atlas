// ADR-060 §16 — les FAITS d'un mandat canonique, saisis là où le mandat naît : signature d'un
// prospect vendeur et création directe d'un bien. Composant présentationnel pur, sans lecture :
// les valeurs sont le vocabulaire fermé d'ADR-055 §F (validé côté serveur par
// `parseFaitsMandatFormData`, jamais un repli sur « simple »). Aucune durée : le terme est une date.
const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";
const helpCls = "text-[12px] text-text-3 mt-1";

export default function MandatFaitsChamps({ typeObligatoire = true }: { typeObligatoire?: boolean }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Type de mandat {typeObligatoire ? "*" : ""}</label>
          <select name="typeMandat" required={typeObligatoire} defaultValue="" className={inputCls}>
            <option value="">— Choisir —</option>
            <option value="simple">Simple</option>
            <option value="exclusif">Exclusif</option>
            <option value="semi_exclusif">Semi-exclusif</option>
          </select>
          {!typeObligatoire && (
            <p className={helpCls}>Obligatoire si le statut du mandat est « Actif » : le mandat canonique est créé avec le bien.</p>
          )}
        </div>
        <div>
          <label className={labelCls}>Numéro de mandat</label>
          <input name="numeroMandat" className={inputCls} placeholder="Registre des mandats" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Terme du mandat</label>
          <input name="dateFinMandat" type="date" className={inputCls} />
          <p className={helpCls}>Dernier jour couvert. Laissez vide si la durée n&apos;est pas connue.</p>
        </div>
        <div>
          <label className={labelCls}>Exclusivité jusqu&apos;au</label>
          <input name="exclusiviteJusquAu" type="date" className={inputCls} />
          <p className={helpCls}>Pour un mandat semi-exclusif, la fin de la période d&apos;exclusivité.</p>
        </div>
      </div>
    </>
  );
}
