import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import SectionTitle from "@/components/ui/SectionTitle";
import { initialesPersonne, nomComplet } from "@/lib/identite/nomPersonne";
import type { ChampIdentiteContact } from "@/types/contactFusion";
import type { CoteFusion, PreparationFusionContacts, ResolutionChampFusion } from "@/types/preparationFusion";
import type { RoleContact } from "@/types/rechercheContact";

// ADR-059 — L'ÉCRAN de fusion : deux Contacts côte à côte, une direction explicite, un choix par
// champ en conflit, l'impact annoncé, les avertissements à acquitter, une confirmation finale. Ce
// composant RENDS ce que le read model a préparé et ne dérive rien : ni valeur inventée (aucun
// champ de saisie libre — l'identité finale se choisit parmi les valeurs existantes), ni décision
// par défaut sur un conflit (radio sans présélection), ni geste hors de l'unique formulaire.
//
// Formulaire natif, Server Action, aucun JavaScript : `required` sur les radios de conflit et la
// confirmation bloque côté navigateur, et le serveur refuse de toute façon.

type PreparationPrete = Extract<PreparationFusionContacts, { statut: "pret" }>;

const LABEL_ROLE: Record<RoleContact, string> = { acquereur: "Acquéreur", vendeur: "Vendeur" };

const LABEL_CHAMP: Record<ChampIdentiteContact, string> = {
  nom: "Nom",
  prenom: "Prénom",
  email: "Email",
  telephone: "Téléphone",
};

export type CodeRefusAffichable =
  | "confirmation_requise"
  | "choix_manquant"
  | "deja_fusionne"
  | "identite_modifiee_entre_temps"
  | "choix_identite_invalide"
  | "avertissement_requis"
  | "page_perimee";

const MESSAGES_REFUS: Record<CodeRefusAffichable, string> = {
  confirmation_requise: "Cochez la confirmation finale pour fusionner les contacts.",
  choix_manquant: "Choisissez une valeur pour chaque champ en conflit avant de fusionner.",
  deja_fusionne: "Un des contacts a déjà été fusionné. Rechargez la page.",
  identite_modifiee_entre_temps:
    "Les informations d’un des contacts ont changé depuis l’ouverture de cette page. Rechargez avant de continuer.",
  choix_identite_invalide: "Le choix effectué ne correspond plus aux valeurs des contacts. Rechargez la page et recommencez.",
  avertissement_requis: "Des identifiants externes diffèrent entre les deux contacts : lisez et acquittez chaque avertissement.",
  page_perimee: "La page n’est plus à jour. Rechargez-la.",
};

function pluriel(n: number, singulier: string, plurielForme: string): string {
  return `${n} ${n > 1 ? plurielForme : singulier}`;
}

function ColonneContact({ titre, cote, accent }: { titre: string; cote: CoteFusion; accent: boolean }) {
  const { contact } = cote;
  return (
    <Card className={`p-4 md:p-5 flex-1 min-w-0 ${accent ? "border-accent" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{titre}</p>
      <div className="flex items-start gap-3 min-w-0">
        <Avatar initiales={initialesPersonne(contact)} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-text-1">{nomComplet(contact)}</h2>
            {cote.roles.map((role) => (
              <Badge key={role} variant="accent">
                {LABEL_ROLE[role]}
              </Badge>
            ))}
          </div>
          <p className="text-[12px] text-text-3 mt-0.5">
            {cote.nbProjets === 0 ? "Aucun projet" : pluriel(cote.nbProjets, "projet", "projets")}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {(["nom", "prenom", "email", "telephone"] as const).map((champ) => (
          <ChampAffiche key={champ} champ={champ} valeur={contact[champ]} verrouille={cote.champsModifiesManuellement.includes(champ)} />
        ))}
      </dl>
    </Card>
  );
}

function ChampAffiche({ champ, valeur, verrouille }: { champ: ChampIdentiteContact; valeur?: string; verrouille: boolean }) {
  return (
    <>
      <dt className="text-text-3">{LABEL_CHAMP[champ]}</dt>
      <dd className="min-w-0 flex flex-wrap items-center gap-2">
        <span className={valeur ? "text-text-1 break-all" : "text-text-3 italic"}>{valeur ?? "—"}</span>
        {verrouille && <Badge variant="muted">Modifié manuellement</Badge>}
      </dd>
    </>
  );
}

function BlocResolution({
  resolution,
  survivant,
  absorbe,
  enErreur,
}: {
  resolution: ResolutionChampFusion;
  survivant: CoteFusion;
  absorbe: CoteFusion;
  enErreur: boolean;
}) {
  const { champ, valeurSurvivant, valeurAbsorbe, nature } = resolution;
  const nom = `choix_${champ}`;

  if (nature === "identique") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
        <input type="hidden" name={nom} value="identique" />
        <span className="text-[13px] text-text-3 w-24">{LABEL_CHAMP[champ]}</span>
        <span className="text-[13px] text-text-1 break-all">{valeurSurvivant ?? "—"}</span>
        <span className="text-[12px] text-text-3">Identique sur les deux contacts</span>
      </div>
    );
  }

  if (nature === "absence_comblee") {
    const valeur = valeurSurvivant ?? valeurAbsorbe;
    const source = valeurSurvivant !== undefined ? "contact conservé" : "contact absorbé";
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
        <input type="hidden" name={nom} value="absence_comblee" />
        <span className="text-[13px] text-text-3 w-24">{LABEL_CHAMP[champ]}</span>
        <span className="text-[13px] text-text-1 break-all">{valeur}</span>
        <span className="text-[12px] text-text-3">Seule valeur renseignée ({source})</span>
      </div>
    );
  }

  return (
    <fieldset className={`py-2 ${enErreur ? "rounded-lg outline outline-2 outline-status-danger px-2" : ""}`}>
      <legend className="text-[13px] font-medium text-text-1 mb-1">
        {LABEL_CHAMP[champ]} — deux valeurs différentes, choisissez celle à conserver
      </legend>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
        <label className="inline-flex items-start gap-2 text-[13px] text-text-1">
          <input type="radio" name={nom} value="survivant" required className="mt-0.5" />
          <span className="min-w-0">
            <span className="break-all">{valeurSurvivant}</span>
            <span className="block text-[12px] text-text-3">
              Contact conservé
              {survivant.champsModifiesManuellement.includes(champ) && " · modifié manuellement"}
            </span>
          </span>
        </label>
        <label className="inline-flex items-start gap-2 text-[13px] text-text-1">
          <input type="radio" name={nom} value="absorbe" required className="mt-0.5" />
          <span className="min-w-0">
            <span className="break-all">{valeurAbsorbe}</span>
            <span className="block text-[12px] text-text-3">
              Contact absorbé
              {absorbe.champsModifiesManuellement.includes(champ) && " · modifié manuellement"}
            </span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

export default function FusionContactsFormulaire({
  preparation,
  action,
  refus,
  champRefus,
}: {
  preparation: PreparationPrete;
  action: (formData: FormData) => Promise<void>;
  refus?: CodeRefusAffichable;
  champRefus?: ChampIdentiteContact;
}) {
  const { survivant, absorbe, champs, impact, avertissements } = preparation;
  const conflits = champs.filter((c) => c.nature === "conflit");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col md:flex-row gap-4">
        <ColonneContact titre="Contact conservé" cote={survivant} accent />
        <ColonneContact titre="Contact absorbé" cote={absorbe} accent={false} />
      </div>
      <div className="flex flex-wrap items-center gap-3 -mt-4">
        <ButtonLink
          href={`/contacts/${absorbe.contact.id}/fusionner/${survivant.contact.id}`}
          variant="secondary"
          size="sm"
        >
          Inverser : conserver {nomComplet(absorbe.contact)}
        </ButtonLink>
        <span className="text-[12px] text-text-3">L’historique du contact absorbé sera rattaché au contact conservé.</span>
      </div>

      {refus && (
        <p role="alert" className="text-[13px] text-status-danger border border-status-danger rounded-lg px-3 py-2">
          {MESSAGES_REFUS[refus]}
          {champRefus && ` (${LABEL_CHAMP[champRefus]})`}
        </p>
      )}

      <form action={action} className="flex flex-col gap-8">
        <input type="hidden" name="survivantId" value={survivant.contact.id} />
        <input type="hidden" name="absorbeId" value={absorbe.contact.id} />
        <input type="hidden" name="survivantModifieLe" value={survivant.identiteAttendue.modifieLe} />
        <input type="hidden" name="absorbeModifieLe" value={absorbe.identiteAttendue.modifieLe} />

        <section>
          <SectionTitle>Identité du contact conservé après fusion</SectionTitle>
          <Card className="px-4 py-2 divide-y divide-border-subtle">
            {champs.map((resolution) => (
              <BlocResolution
                key={resolution.champ}
                resolution={resolution}
                survivant={survivant}
                absorbe={absorbe}
                enErreur={champRefus === resolution.champ}
              />
            ))}
          </Card>
          {conflits.length === 0 && (
            <p className="text-[12px] text-text-3 mt-2">Aucun conflit : les deux identités sont compatibles.</p>
          )}
        </section>

        <section>
          <SectionTitle>Ce que la fusion déplace vers le contact conservé</SectionTitle>
          <Card className="p-4">
            <ul className="text-[13px] text-text-1 flex flex-col gap-1">
              <li>{pluriel(impact.projetsConcernes, "projet concerné", "projets concernés")}</li>
              {impact.projetsCommuns > 0 && (
                <li>
                  {pluriel(impact.projetsCommuns, "participation en double sera regroupée", "participations en double seront regroupées")}
                </li>
              )}
              <li>{pluriel(impact.interactionsDeplacees, "interaction déplacée", "interactions déplacées")}</li>
              <li>{pluriel(impact.dossiersAcquereurDeplaces, "dossier acquéreur déplacé", "dossiers acquéreur déplacés")}</li>
              <li>{pluriel(impact.dossiersVendeurDeplaces, "dossier vendeur déplacé", "dossiers vendeur déplacés")}</li>
              <li>{pluriel(impact.identifiantsExternesDeplaces, "référence externe déplacée", "références externes déplacées")}</li>
            </ul>
          </Card>
        </section>

        {avertissements.length > 0 && (
          <section>
            <SectionTitle>Avertissements à acquitter</SectionTitle>
            <div className="flex flex-col gap-2">
              {avertissements.map((avertissement) => (
                <Card key={avertissement.cle} className="p-4 border-status-warning">
                  <p className="text-[13px] text-text-1">
                    Ces deux contacts possèdent des identifiants différents pour {avertissement.fournisseur} (
                    {avertissement.typeEntiteExterne}) : {avertissement.idsExternesSurvivant.join(", ")} côté conservé,{" "}
                    {avertissement.idsExternesAbsorbe.join(", ")} côté absorbé.
                  </p>
                  <label className="mt-2 inline-flex items-start gap-2 text-[13px] text-text-1">
                    <input type="checkbox" name="acquittement" value={avertissement.cle} required className="mt-0.5" />
                    Je comprends que les deux identifiants externes seront conservés sur le contact conservé.
                  </label>
                </Card>
              ))}
            </div>
          </section>
        )}

        <section>
          <Card className="p-4">
            <label className="inline-flex items-start gap-2 text-[13px] text-text-1">
              <input type="checkbox" name="confirmation" value="oui" required className="mt-0.5" />
              Je confirme qu’il s’agit de la même personne et que l’historique du contact absorbé sera rattaché au contact
              conservé. Cette opération ne peut pas être annulée.
            </label>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Button type="submit" variant="primary" size="md">
                Fusionner les contacts
              </Button>
              <ButtonLink href={`/contacts/${survivant.contact.id}`} variant="ghost" size="md">
                Annuler
              </ButtonLink>
            </div>
          </Card>
        </section>
      </form>
    </div>
  );
}
