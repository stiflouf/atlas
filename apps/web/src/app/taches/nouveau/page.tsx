import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { creerTacheAction } from "@/actions/creerTache";
import CibleTacheSelecteur from "@/components/tache/CibleTacheSelecteur";
import { listerBiensActifsDuWorkspace } from "@/lib/bienRepository";
import { listerAcquereursActifsDuWorkspace } from "@/lib/clientRepository";
import { listerProspectsVendeursDuWorkspace } from "@/lib/prospectVendeurRepository";
import { getContactDuWorkspace } from "@/lib/contactRepository";
import { estContactFusionne } from "@/lib/contactFusion";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { nomComplet } from "@/lib/identite/nomPersonne";
import FormulaireAvecEtat from "@/components/formulaires/FormulaireAvecEtat";
import BoutonSoumettre from "@/components/formulaires/BoutonSoumettre";

const inputCls =
  "w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent";
const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

// Une requête Postgres seule n'empêche pas la génération statique (voir app/page.tsx) : sans ce
// flag, les select bien/acquéreur/prospect vendeur figeraient la liste au moment du build.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ bienId?: string; acquereurId?: string; prospectVendeurId?: string; contactId?: string }>;
};

export default async function NouvelleTachePage({ searchParams }: PageProps) {
  const params = await searchParams;
  // WORKSPACE_SCOPING_V2B1 (ADR-054) — les trois `<select>` de cible ne proposent que des entités
  // du périmètre de session. La création était déjà protégée (V1/V2A) : ce qui change ici, c'est
  // que l'écran cesse de RÉVÉLER les noms et les identifiants d'un autre workspace. Même modèle
  // que /visites/nouvelle, qui utilise ces lecteurs scopés depuis VISIT_NATIVE_ENTRY_V1. Aucun
  // repli de démonstration : un workspace vide propose des listes vides.
  const workspaceId = await exigerWorkspaceCourant();
  const [biens, clients, prospects] = await Promise.all([
    listerBiensActifsDuWorkspace(workspaceId),
    listerAcquereursActifsDuWorkspace(workspaceId),
    listerProspectsVendeursDuWorkspace(workspaceId),
  ]);

  // Préremplissage depuis une fiche (?bienId=/?acquereurId=/?prospectVendeurId=) : uniquement si
  // l'id correspond réellement à une entrée chargée, sinon le select reste sur "Aucun" — pas
  // d'erreur pour un id obsolète ou mal formé. Priorité bien > acquéreur > prospect vendeur si
  // plusieurs paramètres étaient malgré tout présents simultanément dans l'URL (aucun point
  // d'entrée actuel — BienStatutAction/AcquereurHero — n'en génère qu'un seul à la fois ; garde
  // défensive uniquement, cohérente avec le garde backend "au plus une cible").
  const bienIdValide = biens.some((b) => b.id === params.bienId) ? params.bienId : undefined;
  const acquereurIdValide = clients.some((c) => c.id === params.acquereurId) ? params.acquereurId : undefined;
  const prospectVendeurIdValide = prospects.some((p) => p.id === params.prospectVendeurId)
    ? params.prospectVendeurId
    : undefined;

  // TASK_CONTACT_TARGET_V1 (ADR-064) — `?contactId=` est le point d'entrée depuis la fiche contact.
  // Résolu ici par le reader SCOPÉ (`getContactDuWorkspace`, jamais `getContactById`) : un contact
  // d'un autre workspace est introuvable, et l'écran ne révèle donc jamais son nom. Un contact
  // ABSORBÉ est refusé comme préremplissage (ADR-059 §10 — on ne rattache pas une donnée vivante à
  // une identité figée) : le champ reste vide, exactement comme pour un id inconnu, et la garde de
  // création le refuserait de toute façon.
  const contactParametre = params.contactId ? await getContactDuWorkspace(params.contactId, workspaceId) : undefined;
  const contactValide =
    contactParametre && !estContactFusionne(contactParametre) ? contactParametre : undefined;

  const bienIdPreselectionne = bienIdValide ?? "";
  const acquereurIdPreselectionne = !bienIdValide && acquereurIdValide ? acquereurIdValide : "";
  const prospectVendeurIdPreselectionne =
    !bienIdValide && !acquereurIdValide && prospectVendeurIdValide ? prospectVendeurIdValide : "";
  // Même priorité défensive que les trois autres : le contact ne préremplit que si aucune cible
  // dossier ne l'a déjà fait. Aucun point d'entrée actuel ne produit deux paramètres à la fois.
  const contactPreselectionne =
    !bienIdValide && !acquereurIdValide && !prospectVendeurIdValide ? contactValide : undefined;

  // Retour dérivé de la cible réellement préremplie (correctif UX) — jamais un returnUrl
  // arbitraire pris depuis l'URL : uniquement l'un des trois ids déjà validés ci-dessus contre les
  // entités réellement chargées. Sans contexte, comportement générique inchangé (retour "/").
  const redirectTo = bienIdPreselectionne
    ? `/biens/${bienIdPreselectionne}`
    : acquereurIdPreselectionne
      ? `/clients/${acquereurIdPreselectionne}`
      : prospectVendeurIdPreselectionne
        ? `/prospects-vendeurs/${prospectVendeurIdPreselectionne}`
        : contactPreselectionne
          ? `/contacts/${contactPreselectionne.id}`
          : "/";

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Aujourd'hui
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-6">
        Nouvelle tâche
      </h1>

      <FormulaireAvecEtat action={creerTacheAction} className="flex flex-col gap-4" positionErreur="haut">
        <div>
          <label htmlFor="tache-titre" className={labelCls}>
            Titre *
          </label>
          <input
            id="tache-titre"
            name="titre"
            required
            className={inputCls}
            placeholder="Relancer Mme Dupont concernant la maison de Sainte-Geneviève"
          />
        </div>

        <div>
          <label htmlFor="tache-contexte" className={labelCls}>
            Contexte
          </label>
          <textarea id="tache-contexte" name="contexte" rows={3} className={inputCls} placeholder="Appeler avant vendredi" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="tache-type" className={labelCls}>
              Type
            </label>
            <select id="tache-type" name="type" defaultValue="autre" className={inputCls}>
              <option value="appel">Appel</option>
              <option value="email">Email</option>
              <option value="message">Message</option>
              <option value="document">Document</option>
              <option value="relance">Relance</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div>
            <label htmlFor="tache-priorite" className={labelCls}>
              Priorité
            </label>
            <select id="tache-priorite" name="priorite" defaultValue="normale" className={inputCls}>
              <option value="haute">Haute</option>
              <option value="normale">Normale</option>
              <option value="basse">Basse</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="tache-echeance" className={labelCls}>
            Échéance
          </label>
          <input id="tache-echeance" name="echeance" type="date" className={inputCls} placeholder="Sans échéance" />
        </div>

        <input type="hidden" name="redirectTo" value={redirectTo} />

        <CibleTacheSelecteur
          biens={biens.map((bien) => ({ id: bien.id, label: bien.titre }))}
          acquereurs={clients.map((client) => ({ id: client.id, label: nomComplet(client) }))}
          prospectsVendeurs={prospects.map((prospect) => ({
            id: prospect.id,
            label: `${prospect.prenom ? `${prospect.prenom} ` : ""}${prospect.nom}`,
          }))}
          bienIdInitial={bienIdPreselectionne}
          acquereurIdInitial={acquereurIdPreselectionne}
          prospectVendeurIdInitial={prospectVendeurIdPreselectionne}
          contactInitial={
            contactPreselectionne
              ? {
                  id: contactPreselectionne.id,
                  nom: contactPreselectionne.nom,
                  prenom: contactPreselectionne.prenom,
                  email: contactPreselectionne.email,
                }
              : undefined
          }
        />

        <BoutonSoumettre classeBrute="self-start mt-2 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-4 py-2.5 rounded-lg" libelleAttente="Création…">
          Créer la tâche
        </BoutonSoumettre>
      </FormulaireAvecEtat>
    </div>
  );
}
