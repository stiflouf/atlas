import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { creerContactAction } from "@/actions/creerContact";
import BoutonSoumettre from "@/components/formulaires/BoutonSoumettre";
import FormulaireAvecEtat from "@/components/formulaires/FormulaireAvecEtat";
import ButtonLink from "@/components/ui/ButtonLink";
import Input from "@/components/ui/Input";

// CONTACT_STANDALONE_CREATION_V1 — le formulaire d'entrée dans le carnet (ADR-058).
//
// Mêmes quatre champs que l'écran de correction (`/contacts/[id]/modifier`), même frontière de
// saisie (`parseContactFormData`), même patron Server Action : un Contact est une identité, et
// l'identité se saisit au même endroit qu'elle se corrige. Aucun champ métier n'est ajouté — pas
// de budget, pas de projet, pas de rôle, pas de note : rien de tout cela n'est une colonne de
// `contacts` (ADR-055 §A), et le demander ici inventerait une qualification que personne n'a
// décidée.
//
// Aucune lecture en base : l'écran n'a rien à précharger. Il reste donc en rendu dynamique pour la
// seule raison qui vaille — la Server Action et la session qu'elle exige.
export const dynamic = "force-dynamic";

const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

export default function NouveauContactPage() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Contacts
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-1">Nouveau contact</h1>
      <p className="text-[13px] text-text-3 mb-6">
        Enregistrez une personne. Vous pourrez la relier plus tard à un projet, sans rien ressaisir.
      </p>

      <FormulaireAvecEtat action={creerContactAction} className="flex flex-col gap-4" positionErreur="haut">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contact-nom" className={labelCls}>
              Nom *
            </label>
            <Input id="contact-nom" name="nom" required />
          </div>
          <div>
            <label htmlFor="contact-prenom" className={labelCls}>
              Prénom
            </label>
            <Input id="contact-prenom" name="prenom" />
          </div>
          <div>
            <label htmlFor="contact-email" className={labelCls}>
              Email
            </label>
            <Input id="contact-email" name="email" type="email" />
          </div>
          <div>
            <label htmlFor="contact-telephone" className={labelCls}>
              Téléphone
            </label>
            <Input id="contact-telephone" name="telephone" type="tel" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <BoutonSoumettre>Créer le contact</BoutonSoumettre>
          <ButtonLink href="/contacts" variant="ghost" size="md">
            Annuler
          </ButtonLink>
        </div>
      </FormulaireAvecEtat>
    </div>
  );
}
