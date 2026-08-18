const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

// Pas de conditionnalité — aucune interactivité client nécessaire, contrairement aux deux autres
// formulaires fiscaux.
export default function RfrFoyerFormulaire({ action }: { action: (formData: FormData) => Promise<void> }) {
  const anneeEnCours = new Date().getFullYear();

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Année</label>
          <input name="anneeRfr" type="number" required defaultValue={anneeEnCours - 2} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>RFR du foyer (€)</label>
          <input name="rfrFoyer" required placeholder="0,00" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Nombre de parts</label>
          <input name="nombreParts" required placeholder="1,5" className={inputCls} />
        </div>
      </div>

      <button
        type="submit"
        className="self-start text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2 rounded-lg"
      >
        Enregistrer
      </button>
    </form>
  );
}
