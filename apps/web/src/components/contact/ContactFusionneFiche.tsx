import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import { initialesPersonne, nomComplet } from "@/lib/identite/nomPersonne";
import type { Contact } from "@/types/contact";

// ADR-059 — la fiche d'un Contact ABSORBÉ : une page qui EXPLIQUE, jamais une redirection
// silencieuse. Un conseiller qui arrive ici depuis un vieux lien, un favori ou un email doit
// comprendre pourquoi la personne n'est plus là, et où elle continue. HTTP 200, texte explicite,
// un seul geste : ouvrir le contact actif.
//
// L'identité affichée est celle que le contact avait à la fusion — figée, jamais rééditée : aucun
// bouton Modifier, aucune section projets, dossiers, interactions ni similarité. Tout cela vit
// sur le survivant.
//
// Le lien cible le contact actif FINAL (`contactActifId`, résolu par le read model en suivant la
// chaîne A → B → C) : ce composant ne suit rien lui-même, et n'affiche pas le maillon intermédiaire.

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function ContactFusionneFiche({
  contact,
  contactActifId,
  fusionneLe,
}: {
  contact: Contact;
  contactActifId: string;
  fusionneLe: string;
}) {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-4xl">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text-1 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Contacts
      </Link>

      <Card className="p-5 md:p-6">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar initiales={initialesPersonne(contact)} size={52} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-[21px] md:text-[24px] font-semibold text-text-1 leading-tight">{nomComplet(contact)}</h1>
              <Badge variant="muted">Fusionné</Badge>
            </div>
            {(contact.email || contact.telephone) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {contact.email && <span className="text-[13px] text-text-2 break-all">{contact.email}</span>}
                {contact.telephone && <span className="text-[13px] text-text-2">{contact.telephone}</span>}
              </div>
            )}
            <p className="text-[12px] text-text-3 mt-0.5">
              Fusionné le <time dateTime={fusionneLe}>{formatDate(fusionneLe)}</time>
            </p>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-border-subtle">
          <h2 className="text-[15px] font-semibold text-text-1 mb-1">Ce contact a été fusionné</h2>
          <p className="text-[13px] text-text-2 mb-4">
            Ce contact a été fusionné avec un autre contact. Son historique est désormais suivi depuis le contact
            actif ; l’identité affichée ici est celle qu’il avait au moment de la fusion.
          </p>
          <ButtonLink href={`/contacts/${contactActifId}`} variant="primary" size="md">
            Voir le contact actif
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
