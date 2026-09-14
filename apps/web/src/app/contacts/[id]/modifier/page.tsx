import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { modifierContactAction } from "@/actions/modifierContact";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Input from "@/components/ui/Input";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { getContactDuWorkspace } from "@/lib/contactRepository";
import { nomComplet } from "@/lib/identite/nomPersonne";

// ADR-057 — corriger l'identité CANONIQUE d'une personne. Les champs sont préremplis depuis le
// Contact et lui seul : jamais depuis un dossier, dont les colonnes sont l'instantané de sa
// création. Un champ optionnel absent s'affiche vide (`""`, frontière d'input contrôlé) et repart
// en absence à l'enregistrement (contactFormulaire.ts).
//
// Formulaire natif, Server Action, aucune route API. Rien d'autre que l'identité n'est éditable
// ici : rôles, projets et dossiers restent lus.

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

export default async function ModifierContactPage({ params }: PageProps) {
  const { id } = await params;
  // ADR-054 — même règle que la fiche : hors périmètre = introuvable.
  const workspaceId = await exigerWorkspaceCourant();
  const contact = await getContactDuWorkspace(id, workspaceId);
  if (!contact) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/contacts/${contact.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {nomComplet(contact)}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-1">Modifier le contact</h1>
      <p className="text-[13px] text-text-3 mb-6">
        L’identité corrigée ici s’applique à tous les dossiers reliés à cette personne.
      </p>

      <form action={modifierContactAction} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={contact.id} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contact-nom" className={labelCls}>
              Nom *
            </label>
            <Input id="contact-nom" name="nom" required defaultValue={contact.nom} />
          </div>
          <div>
            <label htmlFor="contact-prenom" className={labelCls}>
              Prénom
            </label>
            <Input id="contact-prenom" name="prenom" defaultValue={contact.prenom ?? ""} />
          </div>
          <div>
            <label htmlFor="contact-email" className={labelCls}>
              Email
            </label>
            <Input id="contact-email" name="email" type="email" defaultValue={contact.email ?? ""} />
          </div>
          <div>
            <label htmlFor="contact-telephone" className={labelCls}>
              Téléphone
            </label>
            <Input id="contact-telephone" name="telephone" type="tel" defaultValue={contact.telephone ?? ""} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Button type="submit" variant="primary" size="md">
            Enregistrer
          </Button>
          <ButtonLink href={`/contacts/${contact.id}`} variant="ghost" size="md">
            Annuler
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
