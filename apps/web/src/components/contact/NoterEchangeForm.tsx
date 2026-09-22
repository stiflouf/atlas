import { enregistrerEchangeAction } from "@/actions/enregistrerEchange";
import BoutonSoumettre from "@/components/formulaires/BoutonSoumettre";
import FormulaireAvecEtat from "@/components/formulaires/FormulaireAvecEtat";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import type { ContexteEchange } from "@/lib/timelineContactRepository";
import { ECHANGES_MANUELS } from "@/types/timelineContact";

// Valeur `datetime-local` (sans fuseau) de l'instant courant en heure de Paris — la même convention
// que le parseur de l'action, pour que « maintenant » proposé soit « maintenant » enregistré.
export function maintenantPourDatetimeLocal(instant: Date = new Date()): string {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const v = (type: string) => parties.find((p) => p.type === type)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour") === "24" ? "00" : v("hour")}:${v("minute")}`;
}

// CRM_TIMELINE_V1 — « Noter un échange » : journalise un échange DÉJÀ EU avec cette personne (aucun
// envoi). Formulaire en ligne, une colonne, ouvert par un <details> comme le journal prospect
// vendeur ; `ouvert` sert à l'état vide et au CTA du hero (`#noter-echange`).
export default function NoterEchangeForm({
  contactId,
  contextes,
  dateParDefaut,
  ouvert = false,
}: {
  contactId: string;
  contextes: ContexteEchange[];
  dateParDefaut: string;
  ouvert?: boolean;
}) {
  return (
    <details id="noter-echange" open={ouvert || undefined} className="group">
      <summary className="list-none cursor-pointer select-none inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
        + Noter un échange
      </summary>
      <FormulaireAvecEtat action={enregistrerEchangeAction} className="flex flex-col gap-3 mt-3.5">
        <input type="hidden" name="contactId" value={contactId} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="noter-echange-type" className="text-[12px] font-medium text-text-2 mb-1 block">
              Type d&apos;échange
            </label>
            <Select id="noter-echange-type" name="echange" defaultValue="appel_sortant" required>
              {ECHANGES_MANUELS.map((e) => (
                <option key={e.code} value={e.code}>
                  {e.libelle}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="noter-echange-date" className="text-[12px] font-medium text-text-2 mb-1 block">
              Date et heure
            </label>
            <Input id="noter-echange-date" type="datetime-local" name="survenuLe" defaultValue={dateParDefaut} required />
          </div>
        </div>
        <div>
          <label htmlFor="noter-echange-contenu" className="text-[12px] font-medium text-text-2 mb-1 block">
            Contenu
          </label>
          <Textarea
            id="noter-echange-contenu"
            name="contenu"
            required
            rows={3}
            placeholder="Ce qui s'est dit, ce qui a été convenu..."
          />
        </div>
        {contextes.length > 0 && (
          <div>
            <label htmlFor="noter-echange-contexte" className="text-[12px] font-medium text-text-2 mb-1 block">
              À propos de
            </label>
            <Select id="noter-echange-contexte" name="contexte" defaultValue="">
              <option value="">Le contact en général</option>
              {contextes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.libelle}
                </option>
              ))}
            </Select>
          </div>
        )}
        <p className="text-[11.5px] text-text-3">
          Journalise un échange déjà eu — n&apos;envoie aucun message. Un échange autre qu&apos;une note interne met à
          jour la date de dernier contact de ses dossiers vendeur.
        </p>
        <BoutonSoumettre
          classeBrute="self-start text-[13px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3.5 py-2 rounded-lg"
          libelleAttente="Enregistrement…"
        >
          Enregistrer l&apos;échange
        </BoutonSoumettre>
      </FormulaireAvecEtat>
    </details>
  );
}
