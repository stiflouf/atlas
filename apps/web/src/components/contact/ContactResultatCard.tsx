import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { initialesPersonne, nomComplet } from "@/lib/identite/nomPersonne";
import type { StadeProjet } from "@/types/client";
import { LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";
import type { ResultatRechercheContact, RoleContact } from "@/types/rechercheContact";

// ADR-058 — UNE carte = UNE personne, rendue telle que le read model la livre. Ce composant ne
// dérive rien : rôles, statuts, dernière interaction et ordre viennent de `rechercherContacts`.
// Il ne regroupe jamais deux cartes, même à email ou téléphone identiques (ADR-055 §H).
//
// Aucun lien vers un dossier : le read model expose les projets canoniques, alors que les seules
// fiches existantes sont indexées par dossier historique (`/clients/[id]`, `/prospects-vendeurs/[id]`).
// Plutôt qu'un lien deviné par nom, la carte reste informative jusqu'à la fiche Contact.

const LABEL_ROLE: Record<RoleContact, string> = {
  acquereur: "Acquéreur",
  vendeur: "Vendeur",
};

const LABEL_STADE_PROJET: Record<StadeProjet, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

// Au-delà, la carte deviendrait une fiche : le surplus est compté, pas déroulé.
const MAX_PROJETS_VISIBLES = 2;

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function libelleSurplus(nombre: number): string {
  return `+ ${nombre} autre${nombre > 1 ? "s" : ""}`;
}

export default function ContactResultatCard({ contact }: { contact: ResultatRechercheContact }) {
  const acquereurVisibles = contact.projetsAcquereur.slice(0, MAX_PROJETS_VISIBLES);
  const acquereurSurplus = contact.projetsAcquereur.length - acquereurVisibles.length;
  const vendeurVisibles = contact.projetsVendeur.slice(0, MAX_PROJETS_VISIBLES);
  const vendeurSurplus = contact.projetsVendeur.length - vendeurVisibles.length;

  return (
    <Card>
      <article className="flex items-start gap-4 p-4">
        <Avatar initiales={initialesPersonne(contact)} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[14px] font-medium text-text-1">{nomComplet(contact)}</h3>
            {contact.roles.map((role) => (
              <Badge key={role} variant="accent">
                {LABEL_ROLE[role]}
              </Badge>
            ))}
          </div>

          {(contact.email || contact.telephone) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="text-[13px] text-text-2 hover:text-accent break-all">
                  {contact.email}
                </a>
              )}
              {contact.telephone && (
                <a href={`tel:${contact.telephone}`} className="text-[13px] text-text-2 hover:text-accent">
                  {contact.telephone}
                </a>
              )}
            </div>
          )}

          {(acquereurVisibles.length > 0 || vendeurVisibles.length > 0) && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {acquereurVisibles.map((projet) => (
                <li key={projet.projetId} className="text-[13px] text-text-2">
                  <span className="text-text-3">Acquéreur</span> · {formatPrix(projet.budgetMin)} –{" "}
                  {formatPrix(projet.budgetMax)} · {LABEL_STADE_PROJET[projet.stade]}
                </li>
              ))}
              {acquereurSurplus > 0 && (
                <li className="text-[12px] text-text-3">
                  <span className="sr-only">Projets acquéreur : </span>
                  {libelleSurplus(acquereurSurplus)}
                </li>
              )}
              {vendeurVisibles.map((projet) => (
                <li key={projet.projetId} className="text-[13px] text-text-2">
                  <span className="text-text-3">Vendeur</span> · {LABEL_STATUT_PROSPECT_VENDEUR[projet.statut]}
                </li>
              ))}
              {vendeurSurplus > 0 && (
                <li className="text-[12px] text-text-3">
                  <span className="sr-only">Projets vendeur : </span>
                  {libelleSurplus(vendeurSurplus)}
                </li>
              )}
            </ul>
          )}

          <p className="text-[12px] text-text-3 mt-2">
            {contact.derniereInteractionLe
              ? `Dernier échange : ${formatDate(contact.derniereInteractionLe)}`
              : "Aucun échange enregistré"}
          </p>
        </div>
      </article>
    </Card>
  );
}
