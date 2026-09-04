import Card from "@/components/ui/Card";
import {
  LABEL_CATEGORIE_REPERE_RELATIONNEL,
  LABEL_PROVENANCE_REPERE_RELATIONNEL,
  type RepereRelationnel,
} from "@/types/repereRelationnel";

// VALUE-07B (ADR-053) — bloc d'affichage, rendu CÔTÉ SERVEUR et volontairement dépourvu de
// "use client". Il est voisin du formulaire de rédaction, jamais dedans : les repères ne doivent
// atteindre ni l'état React du brouillon, ni un champ caché, ni le FormData de la reformulation.
// Le libellé apparaît évidemment dans le HTML — c'est le but, il est écrit POUR le conseiller. La
// frontière tenue ici n'est pas « le navigateur ne le voit jamais », c'est « affiché n'est pas
// rédigé ».
//
// Aucune mention d'IA, aucun compteur « n repères pris en compte », aucun vocabulaire de
// personnalisation automatique : rien n'est utilisé automatiquement, et le bloc ne doit jamais
// laisser croire le contraire.

export default function ReperesPourEchange({
  reperes,
  presencePreferenceContact,
}: {
  reperes: RepereRelationnel[];
  presencePreferenceContact: boolean;
}) {
  // Rien à montrer : pas de bloc vide, pas d'état « aucun repère » à lire pour rien.
  if (reperes.length === 0) return null;

  return (
    <Card className="p-4 mb-6">
      <p className="text-[11px] font-medium text-text-2 mb-2.5">Repères pour cet échange</p>
      <ul className="flex flex-col gap-2.5">
        {reperes.map((repere) => (
          <li key={repere.id}>
            <p className="text-[13.5px] text-text-1">{repere.libelle}</p>
            <p className="text-[11px] text-text-3 mt-0.5">
              {LABEL_CATEGORIE_REPERE_RELATIONNEL[repere.categorie]} ·{" "}
              {LABEL_PROVENANCE_REPERE_RELATIONNEL[repere.provenance]}
            </p>
          </li>
        ))}
      </ul>
      {/* Dépend UNIQUEMENT de `categorie === "preference_contact"`. DOMIORA ne prétend pas savoir
          quel canal est préféré, ni si le canal courant le contredit : l'affirmer supposerait de
          lire le libellé libre. La phrase renvoie donc au jugement du conseiller, qui a le repère
          sous les yeux. */}
      {presencePreferenceContact && (
        <p className="text-[11px] text-text-3 mt-3 pt-3 border-t border-border-subtle">
          Une préférence de contact est enregistrée. Vérifiez que le canal choisi lui correspond.
        </p>
      )}
    </Card>
  );
}
