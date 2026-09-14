import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import SectionTitle from "@/components/ui/SectionTitle";
import { initialesPersonne, nomComplet } from "@/lib/identite/nomPersonne";
import type { RoleContact } from "@/types/rechercheContact";
import type { ContactSimilaire, SignalSimilariteContact } from "@/types/similariteContact";

// ADR-055 §H — SIGNALER des coordonnées communes, jamais conclure. Ce composant rend ce que
// `trouverContactsSimilaires` a livré : les FAITS (« Même email »), dans l'ordre du read model,
// sans score, sans niveau, sans verdict. Il ne dérive rien : ni signal, ni rôle, ni ordre, ni
// borne — tout cela est décidé dans le repository, une seule fois.
//
// Une seule destination par candidat : sa fiche Contact. Aucun geste de fusion, de rattachement
// ni d'écriture n'existe ici — le produit ne fusionne jamais deux humains sans qu'un humain l'ait
// décidé, et ce geste n'a pas encore de chemin.
//
// Rien n'est rendu sans candidat : « aucun doublon détecté » serait une affirmation que la
// détection ne peut pas faire (elle ignore un email ou un numéro qui a changé).

const LABEL_ROLE: Record<RoleContact, string> = {
  acquereur: "Acquéreur",
  vendeur: "Vendeur",
};

const LABEL_SIGNAL: Record<SignalSimilariteContact, string> = {
  email: "Même email",
  telephone: "Même téléphone",
  nom_prenom: "Même nom et prénom",
};

function libelleProjets(nombre: number): string {
  if (nombre === 0) return "Aucun projet";
  return `${nombre} projet${nombre > 1 ? "s" : ""}`;
}

export default function ContactsSimilairesSection({ candidats }: { candidats: ContactSimilaire[] }) {
  if (candidats.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionTitle>Contacts partageant un email ou un téléphone</SectionTitle>
      <p className="text-[12px] text-text-3 mb-3">
        Ces contacts ont des coordonnées communes avec cette personne. Cela ne signifie pas nécessairement qu’il
        s’agit de la même personne.
      </p>
      <div className="flex flex-col gap-2">
        {candidats.map((candidat) => (
          <Card key={candidat.contactId}>
            <article className="flex flex-col sm:flex-row sm:items-start gap-3 p-4">
              <Avatar initiales={initialesPersonne(candidat)} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-[14px] font-medium text-text-1">{nomComplet(candidat)}</h3>
                  {candidat.roles.map((role) => (
                    <Badge key={role} variant="accent">
                      {LABEL_ROLE[role]}
                    </Badge>
                  ))}
                  <span className="text-[12px] text-text-3">{libelleProjets(candidat.nbProjets)}</span>
                </div>

                <ul className="flex flex-wrap gap-1.5 mt-1.5" aria-label="Coordonnées communes">
                  {candidat.signaux.map((signal) => (
                    <li key={signal}>
                      <Badge variant="default">{LABEL_SIGNAL[signal]}</Badge>
                    </li>
                  ))}
                </ul>

                {(candidat.email || candidat.telephone) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                    {candidat.email && <span className="text-[13px] text-text-2 break-all">{candidat.email}</span>}
                    {candidat.telephone && <span className="text-[13px] text-text-2">{candidat.telephone}</span>}
                  </div>
                )}
              </div>
              <ButtonLink
                href={`/contacts/${candidat.contactId}`}
                variant="secondary"
                size="sm"
                className="shrink-0 self-start"
              >
                Voir le contact
              </ButtonLink>
            </article>
          </Card>
        ))}
      </div>
    </section>
  );
}
