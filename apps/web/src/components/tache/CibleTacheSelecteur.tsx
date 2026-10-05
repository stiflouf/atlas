"use client";

import { useState, useTransition } from "react";
import {
  rechercherContactsCibleTacheAction,
  type ContactCandidatCible,
} from "@/actions/rechercherContactsCibleTache";
import { nomComplet } from "@/lib/identite/nomPersonne";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

type Option = { id: string; label: string };
export type CiblesTache = { bienId: string; acquereurId: string; prospectVendeurId: string; contactId: string };

const CIBLES_VIDES: CiblesTache = { bienId: "", acquereurId: "", prospectVendeurId: "", contactId: "" };

// Exclusivité des quatre cibles (logique pure, testable sans DOM) — correctif UX : le garde métier
// "au plus une cible" existait déjà côté serveur (creerTache.ts, miroir du CHECK
// taches_une_seule_cible_check) mais rien n'empêchait auparavant de sélectionner les trois en même
// temps dans le formulaire, menant systématiquement à un rejet backend évitable. Choisir une cible
// non vide vide systématiquement les autres (solution A du chantier, la plus étroite) ;
// repasser la cible déjà active à "Aucun" ne touche pas les autres (déjà vides par
// construction, cet appel ne fait jamais que deux d'entre elles soient non vides simultanément).
//
// TASK_CONTACT_TARGET_V1 (ADR-064) — `contactId` entre dans la MÊME règle : un contact canonique
// est une cible comme les trois autres, pas un rattachement supplémentaire qui s'ajouterait à elles.
export function appliquerExclusiviteCible(
  cibles: CiblesTache,
  champModifie: keyof CiblesTache,
  valeur: string
): CiblesTache {
  if (!valeur) return { ...cibles, [champModifie]: "" };
  return { ...CIBLES_VIDES, [champModifie]: valeur };
}

// Le garde backend n'est PAS remplacé par cette UI : une requête forgée avec plusieurs cibles
// reste rejetée par creerTache.ts, cette exclusivité n'empêche que l'erreur normale d'un
// utilisateur réel dans ce formulaire.
export default function CibleTacheSelecteur({
  biens,
  acquereurs,
  prospectsVendeurs,
  bienIdInitial,
  acquereurIdInitial,
  prospectVendeurIdInitial,
  contactInitial,
}: {
  biens: Option[];
  acquereurs: Option[];
  prospectsVendeurs: Option[];
  bienIdInitial: string;
  acquereurIdInitial: string;
  prospectVendeurIdInitial: string;
  // Le contact préselectionné arrive DÉJÀ résolu par le serveur (`?contactId=`), jamais sous forme
  // d'un simple id que ce composant devrait aller nommer lui-même.
  contactInitial?: ContactCandidatCible;
}) {
  const [cibles, setCibles] = useState<CiblesTache>({
    bienId: bienIdInitial,
    acquereurId: acquereurIdInitial,
    prospectVendeurId: prospectVendeurIdInitial,
    contactId: contactInitial?.id ?? "",
  });
  const [recherche, setRecherche] = useState("");
  // Les candidats proposés ET le contact retenu sont deux états distincts : fermer la liste de
  // résultats ne doit jamais faire oublier qui a été choisi.
  const [candidats, setCandidats] = useState<ContactCandidatCible[]>([]);
  const [rechercheEffectuee, setRechercheEffectuee] = useState(false);
  const [contactChoisi, setContactChoisi] = useState<ContactCandidatCible | undefined>(contactInitial);
  const [enRecherche, demarrerRecherche] = useTransition();

  // Recherche SERVEUR explicite (bouton, jamais à la frappe) : `contacts` est l'unité de recherche
  // du produit (ADR-058) et son carnet n'a pas de taille bornée — il n'entre pas dans un `<select>`.
  // Un geste explicite évite aussi une requête par caractère tapé.
  function lancerRecherche() {
    demarrerRecherche(async () => {
      const resultats = await rechercherContactsCibleTacheAction(recherche);
      setCandidats(resultats);
      setRechercheEffectuee(true);
    });
  }

  function choisirContact(contact: ContactCandidatCible | undefined) {
    setContactChoisi(contact);
    setCibles((c) => appliquerExclusiviteCible(c, "contactId", contact?.id ?? ""));
  }

  function choisirDossier(champ: keyof CiblesTache, valeur: string) {
    setCibles((c) => appliquerExclusiviteCible(c, champ, valeur));
    // Choisir un bien, un acquéreur ou un prospect retire la cible contact : l'exclusivité doit se
    // VOIR, pas seulement exister dans l'état envoyé.
    if (valeur) setContactChoisi(undefined);
  }

  return (
    <div className="border-t border-border pt-4 mt-2">
      <p className="text-[12px] text-text-3 mb-3">
        Une tâche peut être rattachée à une seule cible à la fois — un bien, un acquéreur, un
        prospect vendeur ou un contact — ou à aucun des quatre pour une tâche générale.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="tache-bienId" className={labelCls}>
            Bien
          </label>
          <select
            id="tache-bienId"
            name="bienId"
            value={cibles.bienId}
            onChange={(e) => choisirDossier("bienId", e.target.value)}
            className={inputCls}
          >
            <option value="">Aucun</option>
            {biens.map((bien) => (
              <option key={bien.id} value={bien.id}>
                {bien.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tache-acquereurId" className={labelCls}>
            Acquéreur
          </label>
          <select
            id="tache-acquereurId"
            name="acquereurId"
            value={cibles.acquereurId}
            onChange={(e) => choisirDossier("acquereurId", e.target.value)}
            className={inputCls}
          >
            <option value="">Aucun</option>
            {acquereurs.map((acquereur) => (
              <option key={acquereur.id} value={acquereur.id}>
                {acquereur.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tache-prospectVendeurId" className={labelCls}>
            Prospect vendeur
          </label>
          <select
            id="tache-prospectVendeurId"
            name="prospectVendeurId"
            value={cibles.prospectVendeurId}
            onChange={(e) => choisirDossier("prospectVendeurId", e.target.value)}
            className={inputCls}
          >
            <option value="">Aucun</option>
            {prospectsVendeurs.map((prospect) => (
              <option key={prospect.id} value={prospect.id}>
                {prospect.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="tache-contact-recherche" className={labelCls}>
          Contact
        </label>
        {/* La cible réellement soumise : l'id du contact retenu, jamais le texte tapé. Le champ de
            recherche ci-dessous n'a pas de `name` — il ne part pas au serveur et ne peut donc pas
            devenir un nom à interpréter. */}
        <input type="hidden" name="contactId" value={cibles.contactId} />
        <div className="flex items-center gap-2">
          <input
            id="tache-contact-recherche"
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            onKeyDown={(e) => {
              // Entrée dans ce champ CHERCHE, elle ne soumet pas le formulaire : une recherche à
              // moitié tapée créerait sinon la tâche sans sa cible.
              if (e.key === "Enter") {
                e.preventDefault();
                lancerRecherche();
              }
            }}
            className={inputCls}
            placeholder="Nom, prénom, email ou téléphone"
            aria-describedby="tache-contact-aide"
          />
          <button
            type="button"
            onClick={lancerRecherche}
            disabled={enRecherche}
            className="shrink-0 text-[13px] font-medium text-text-1 border border-border-md hover:bg-surface-muted transition-colors px-3 py-2 rounded-lg disabled:opacity-60"
          >
            {enRecherche ? "Recherche…" : "Rechercher"}
          </button>
        </div>
        <p id="tache-contact-aide" className="text-[11px] text-text-3 mt-1">
          Cherchez la personne dans votre carnet de contacts, puis choisissez-la.
        </p>

        {contactChoisi && (
          <p className="text-[13px] text-text-1 mt-2">
            Contact retenu : {nomComplet(contactChoisi)}
            {contactChoisi.email ? ` — ${contactChoisi.email}` : " — aucune adresse email connue"}{" "}
            <button
              type="button"
              onClick={() => choisirContact(undefined)}
              className="text-[11px] font-medium text-action-primary hover:underline ml-1"
            >
              Retirer
            </button>
          </p>
        )}

        {rechercheEffectuee && candidats.length === 0 && (
          <p className="text-[12.5px] text-text-3 mt-2">Aucun contact ne correspond à cette recherche.</p>
        )}

        {candidats.length > 0 && (
          // `role` par défaut d'une liste de boutons : la navigation clavier est celle du document
          // (Tab/Entrée), jamais une liste déroulante custom qui réimplémenterait mal les flèches.
          <ul className="mt-2 flex flex-col gap-1">
            {candidats.map((candidat) => (
              <li key={candidat.id}>
                <button
                  type="button"
                  onClick={() => choisirContact(candidat)}
                  aria-pressed={cibles.contactId === candidat.id}
                  className="text-left text-[13px] text-text-1 hover:bg-surface-muted rounded-md px-2 py-1 w-full"
                >
                  {nomComplet(candidat)}
                  {/* Un contact sans email est montré TEL QUEL — jamais masqué, jamais complété
                      depuis un dossier (ADR-057) : le conseiller voit avant de choisir qu'aucun
                      email ne pourra être préparé. */}
                  <span className="text-[11px] text-text-3">
                    {candidat.email ? ` — ${candidat.email}` : " — aucune adresse email connue"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
