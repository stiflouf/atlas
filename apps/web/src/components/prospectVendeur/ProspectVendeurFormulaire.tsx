import type { ProspectVendeur } from "@/types/prospectVendeur";
import { ORIGINES_LEAD, LABEL_ORIGINE_LEAD } from "@/types/origineLead";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";
const helpCls = "text-[12px] text-text-3 mt-1";

const TYPES_BIEN: { value: string; label: string }[] = [
  { value: "appartement", label: "Appartement" },
  { value: "maison", label: "Maison" },
  { value: "studio", label: "Studio" },
  { value: "loft", label: "Loft" },
  { value: "local_commercial", label: "Local commercial" },
];

// Formulaire partagé création/édition (même principe que AcquereurFormulaire) : ne touche jamais
// aux jalons, à l'issue commerciale, à la conversion ni à l'archivage — uniquement les champs
// saisissables à la création (NouveauProspectVendeur, ADR-027). adresseBienPotentiel et
// secteurBienPotentiel restent deux champs distincts à la saisie, jamais fusionnés.
export default function ProspectVendeurFormulaire({
  prospect,
  action,
  libelleSubmit,
}: {
  prospect?: ProspectVendeur;
  action: (formData: FormData) => Promise<void>;
  libelleSubmit: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {prospect && <input type="hidden" name="id" value={prospect.id} />}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Nom *</label>
          <input name="nom" required defaultValue={prospect?.nom ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Prénom</label>
          <input name="prenom" defaultValue={prospect?.prenom ?? ""} className={inputCls} />
          <p className={helpCls}>Facultatif — un lead peut n&apos;être connu que par son nom.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Email</label>
          <input name="email" type="email" defaultValue={prospect?.email ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Téléphone</label>
          <input name="telephone" defaultValue={prospect?.telephone ?? ""} className={inputCls} />
        </div>
      </div>
      <p className={helpCls}>
        Les deux sont facultatifs — un lead de prospection terrain peut être enregistré avant même
        d&apos;avoir une coordonnée de contact directe.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Origine du lead</label>
          <select name="origineLead" defaultValue={prospect?.origineLead ?? ""} className={inputCls}>
            <option value="">Non déterminée</option>
            {ORIGINES_LEAD.map((o) => (
              <option key={o} value={o}>
                {LABEL_ORIGINE_LEAD[o]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Détail de l&apos;origine</label>
          <input
            name="origineLeadDetail"
            defaultValue={prospect?.origineLeadDetail ?? ""}
            className={inputCls}
            placeholder="ex. Facebook, SeLoger..."
          />
        </div>
      </div>

      <div className="border-t border-border pt-4 mt-2">
        <p className="text-[12px] text-text-3 mb-3">Bien potentiel — tout est facultatif à ce stade.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Adresse précise</label>
            <input
              name="adresseBienPotentiel"
              defaultValue={prospect?.adresseBienPotentiel ?? ""}
              className={inputCls}
              placeholder="ex. 12 rue de la Paix"
            />
          </div>
          <div>
            <label className={labelCls}>Secteur approximatif</label>
            <input
              name="secteurBienPotentiel"
              defaultValue={prospect?.secteurBienPotentiel ?? ""}
              className={inputCls}
              placeholder="ex. Quartier centre-ville"
            />
          </div>
          <div>
            <label className={labelCls}>Ville</label>
            <input name="ville" defaultValue={prospect?.ville ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Code postal</label>
            <input name="codePostal" defaultValue={prospect?.codePostal ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Type de bien</label>
            <select name="typeBien" defaultValue={prospect?.typeBien ?? ""} className={inputCls}>
              <option value="">Inconnu</option>
              {TYPES_BIEN.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button
        type="submit"
        className="self-start mt-2 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg"
      >
        {libelleSubmit}
      </button>
    </form>
  );
}
