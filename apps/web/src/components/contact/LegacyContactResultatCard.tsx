import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import { initialesPersonne, nomComplet } from "@/lib/identite/nomPersonne";
import type { ResultatLegacyAcquereur, ResultatLegacyVendeur } from "@/types/recherchePersonne";

// ADR-058 décision 5 — UN dossier historique non rattaché, rendu comme tel : la personne n'est pas
// encore un Contact, et la carte le dit en toutes lettres (« Non rattaché »), jamais par une seule
// couleur. Deux actions, toutes deux vers la fiche du dossier : l'ouvrir, ou aller rattacher —
// le rattachement lui-même reste le geste explicite de la fiche (RattachementContactSection), qui
// porte déjà la recherche de candidats, la création et les refus. Rien n'est réembarqué ici.
//
// Cette carte ne compare rien avec les cartes Contact voisines : deux résultats qui se ressemblent
// sont montrés côte à côte, et c'est l'humain qui reconnaît — ou non — la même personne.

type Props = {
  resultat: ResultatLegacyAcquereur | ResultatLegacyVendeur;
  // Le terme cherché, transmis à la fiche pour préremplir la recherche de candidats.
  q?: string;
};

function hrefDossier(resultat: Props["resultat"]): string {
  return resultat.type === "legacy_acquereur"
    ? `/clients/${resultat.acquereurId}`
    : `/prospects-vendeurs/${resultat.prospectVendeurId}`;
}

function hrefRattacher(resultat: Props["resultat"], q: string | undefined): string {
  const base = hrefDossier(resultat);
  return `${q ? `${base}?q=${encodeURIComponent(q)}` : base}#rattachement`;
}

export default function LegacyContactResultatCard({ resultat, q }: Props) {
  const role = resultat.type === "legacy_acquereur" ? "Acquéreur" : "Vendeur";

  return (
    <Card className="border-dashed">
      <article className="flex items-start gap-4 p-4">
        <Avatar initiales={initialesPersonne(resultat)} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[14px] font-medium text-text-1">{nomComplet(resultat)}</h3>
            <Badge variant="warning">Non rattaché</Badge>
            <Badge variant="muted">{role}</Badge>
          </div>

          {(resultat.email || resultat.telephone) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              {resultat.email && (
                <a href={`mailto:${resultat.email}`} className="text-[13px] text-text-2 hover:text-accent break-all">
                  {resultat.email}
                </a>
              )}
              {resultat.telephone && (
                <a href={`tel:${resultat.telephone}`} className="text-[13px] text-text-2 hover:text-accent">
                  {resultat.telephone}
                </a>
              )}
            </div>
          )}

          <p className="text-[12px] text-text-3 mt-2">
            Dossier historique, pas encore relié à un contact. Rattachez-le pour retrouver cette personne avec
            tous ses projets.
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <ButtonLink href={hrefDossier(resultat)} variant="secondary" size="sm">
              Ouvrir le dossier
            </ButtonLink>
            <ButtonLink href={hrefRattacher(resultat, q)} variant="ghost" size="sm">
              Rattacher
            </ButtonLink>
          </div>
        </div>
      </article>
    </Card>
  );
}
