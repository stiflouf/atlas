const inputCls =
  "w-full border border-[#e2e8f0] rounded-lg px-3 py-2 text-[14px] text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#4338ca]/20 focus:border-[#4338ca]";
const labelCls = "text-[12px] font-medium text-[#64748b] mb-1 block";

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
        className="self-start text-[13px] font-medium text-white bg-[#4338ca] hover:bg-[#3730a3] transition-colors px-4 py-2 rounded-lg"
      >
        Enregistrer
      </button>
    </form>
  );
}
