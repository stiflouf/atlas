import { UserPlus } from "lucide-react";
import type { Contact } from "@/types/contact";
import { nomComplet } from "@/lib/identite/nomPersonne";

// ADR-055 §H — le bloc qui rend le rattachement POSSIBLE et JAMAIS automatique. Deux boutons
// distincts, parce que ce sont deux décisions distinctes : reconnaître une personne déjà connue, ou
// déclarer qu'il s'agit d'une nouvelle.
//
// « Créer un nouveau contact » reste offert MÊME quand des candidats sont proposés : c'est ce qui
// matérialise la doctrine à l'écran. Deux personnes peuvent partager une adresse email — le produit
// le montre, il n'en conclut rien.
//
// Recherche en formulaire GET natif, comme partout ailleurs dans ce produit (ADR-048) : aucune
// dépendance JavaScript pour un geste aussi important.

type Props = {
  champIdDossier: "acquereurId" | "prospectId";
  idDossier: string;
  cheminRetour: string;
  q?: string;
  candidats: Contact[];
  // Refus remonté par l'action, affiché tel quel — jamais avalé en silence.
  refus?: string;
  actionRattacherExistant: (formData: FormData) => Promise<void>;
  actionCreerContact: (formData: FormData) => Promise<void>;
};

const MESSAGES_REFUS: Record<string, string> = {
  deja_rattache:
    "Ce dossier est déjà rattaché à un contact. Changer la personne d'un dossier est une opération à part, qui n'existe pas encore.",
  contact_introuvable: "Ce contact n'existe plus.",
  workspace: "Ce contact appartient à un autre espace de travail.",
  introuvable: "Ce dossier est introuvable.",
};

export default function RattachementContactSection({
  champIdDossier,
  idDossier,
  cheminRetour,
  q,
  candidats,
  refus,
  actionRattacherExistant,
  actionCreerContact,
}: Props) {
  return (
    <section
      id="rattachement"
      className="border border-dashed border-border-md rounded-xl p-4 md:p-5 flex flex-col gap-3 scroll-mt-4"
    >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full bg-surface-muted text-text-3 flex items-center justify-center shrink-0">
          <UserPlus size={16} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-text-1">Identité non rattachée</p>
          <p className="text-[12.5px] text-text-3 mt-0.5">
            Ce dossier porte encore sa propre copie de l&apos;identité. Le rattacher à un contact permet de corriger
            cette personne à un seul endroit, pour tous ses dossiers.
          </p>
        </div>
      </div>

      {refus && (
        <p role="alert" className="text-[12.5px] text-danger">
          {MESSAGES_REFUS[refus] ?? "Le rattachement n'a pas pu être effectué."}
        </p>
      )}

      <form method="GET" action={cheminRetour} className="flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Rechercher un contact existant (nom, email, téléphone)"
          className="flex-1 border border-border-md rounded-lg px-3 py-2 text-[13px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
        <button
          type="submit"
          className="text-[13px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3.5 py-2 rounded-lg shrink-0"
        >
          Rechercher
        </button>
      </form>

      {q && candidats.length === 0 && (
        <p className="text-[12.5px] text-text-3">Aucun contact ne correspond à cette recherche.</p>
      )}

      {candidats.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {candidats.map((candidat) => (
            <li key={candidat.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] text-text-1">{nomComplet(candidat)}</p>
                <p className="text-[12px] text-text-3">
                  {[candidat.email, candidat.telephone].filter(Boolean).join(" · ") || "Aucune coordonnée"}
                </p>
              </div>
              <form action={actionRattacherExistant} className="shrink-0">
                <input type="hidden" name={champIdDossier} value={idDossier} />
                <input type="hidden" name="contactId" value={candidat.id} />
                <button
                  type="submit"
                  className="text-[12.5px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3 py-1.5 rounded-lg"
                >
                  Rattacher
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={actionCreerContact} className="pt-1">
        <input type="hidden" name={champIdDossier} value={idDossier} />
        <button
          type="submit"
          className="text-[12.5px] font-medium text-text-2 hover:text-text-1 transition-colors underline underline-offset-2"
        >
          Créer un nouveau contact depuis ce dossier
        </button>
      </form>
    </section>
  );
}
