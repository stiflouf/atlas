import { notFound } from "next/navigation";
import { enregistrerIdentiteResponsableAction } from "@/actions/identiteResponsablePrivacy";
import BoutonSoumettre from "@/components/formulaires/BoutonSoumettre";
import FormulaireAvecEtat from "@/components/formulaires/FormulaireAvecEtat";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { exigerOwnerWorkspaceCourant } from "@/lib/auth/ownerWorkspaceCourant";
import {
  LIBELLES_CHAMPS_REQUIS,
  champsManquantsPourNotice,
  etatIdentiteResponsable,
} from "@/lib/privacy/identiteResponsable";
import { PRIVACY_NOTICE_VERSION, blocagesPublicationNotice } from "@/lib/privacy/politiqueConfidentialite";
import { getIdentiteResponsable } from "@/lib/workspacePrivacyRepository";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — écran de configuration de l'identité du responsable
// du traitement, réservé au propriétaire du workspace.
//
// `exigerOwnerWorkspaceCourant()` est la PREMIÈRE instruction : la garde précède toute lecture, et
// ne dépend d'aucun paramètre d'URL — il n'y en a pas, l'écran porte toujours sur le workspace de
// la session. Une identité d'un autre périmètre n'est donc pas « refusée » : elle n'est pas
// adressable.
//
// CE QUE CET ÉCRAN N'EST PAS : une notice. Aucun texte destiné aux personnes concernées n'y figure,
// et rien n'est publié par ce lot. Il sert à réunir une information exacte AVANT qu'une notice
// existe, et à dire honnêtement où l'on en est.

export const dynamic = "force-dynamic";

const labelCls = "text-[12px] font-medium text-text-2 mb-1 block";

export default async function ParametresConfidentialitePage() {
  const workspaceId = await exigerOwnerWorkspaceCourant();
  const identite = await getIdentiteResponsable(workspaceId);
  if (!identite) notFound();

  const manquants = champsManquantsPourNotice(identite);
  const etat = etatIdentiteResponsable(identite);
  const blocages = blocagesPublicationNotice();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <h1 className="text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight mb-1">
        Confidentialité — responsable du traitement
      </h1>
      <p className="text-[13px] text-text-3 mb-6">
        Ces informations identifient la personne physique ou morale responsable du traitement des
        données des contacts, acquéreurs, vendeurs et visiteurs de ce workspace. Elles ne sont pas
        encore publiées.
      </p>

      <section className="mb-6 rounded-lg border border-border-subtle px-4 py-3" aria-labelledby="etat-config">
        <div className="flex items-center gap-2 mb-2">
          <h2 id="etat-config" className="text-[13px] font-medium text-text-1">
            État de la configuration
          </h2>
          <Badge variant={etat === "PRETE_POUR_LA_NOTICE" ? "success" : "warning"}>
            {etat === "PRETE_POUR_LA_NOTICE" ? "Prête pour la notice" : "Incomplète"}
          </Badge>
        </div>
        {manquants.length > 0 ? (
          <>
            <p className="text-[13px] text-text-2 mb-1">Informations encore nécessaires :</p>
            <ul className="text-[13px] text-text-2 list-disc pl-5">
              {manquants.map((champ) => (
                <li key={champ}>{LIBELLES_CHAMPS_REQUIS[champ]}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[13px] text-text-2">
            Le minimum nécessaire pour identifier le responsable du traitement et permettre
            l’exercice des droits est renseigné.
          </p>
        )}
      </section>

      {/*
        Information honnête sur ce qui reste à faire : l'identité complète ne suffit pas à publier
        une notice. Afficher « prête pour la notice » sans dire que la publication reste désactivée,
        et pourquoi, laisserait croire le travail terminé.
      */}
      <section className="mb-8 rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3" aria-labelledby="etat-publication">
        <h2 id="etat-publication" className="text-[13px] font-medium text-text-1 mb-2">
          Publication
        </h2>
        <p className="text-[13px] text-text-2 mb-2">
          Aucune notice n’est publiée aux personnes concernées à ce stade, et aucune information
          n’est affichée sur le bon de visite. Version des décisions en vigueur :{" "}
          <span className="font-mono">{PRIVACY_NOTICE_VERSION}</span>.
        </p>
        {blocages.length > 0 && (
          <ul className="text-[13px] text-text-2 list-disc pl-5">
            {blocages.map((blocage) => (
              <li key={blocage.cle}>{blocage.explication}</li>
            ))}
          </ul>
        )}
      </section>

      <FormulaireAvecEtat
        action={enregistrerIdentiteResponsableAction}
        className="flex flex-col gap-4"
        positionErreur="haut"
      >
        <div>
          <label htmlFor="controllerLegalName" className={labelCls}>
            Nom légal du responsable du traitement
          </label>
          <Input
            id="controllerLegalName"
            name="controllerLegalName"
            defaultValue={identite.controllerLegalName ?? ""}
            placeholder="Prénom Nom pour une entreprise individuelle, ou raison sociale"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="controllerLegalForm" className={labelCls}>
              Forme juridique
            </label>
            <Input
              id="controllerLegalForm"
              name="controllerLegalForm"
              defaultValue={identite.controllerLegalForm ?? ""}
              placeholder="EI, SAS, SARL…"
            />
          </div>
          <div>
            <label htmlFor="controllerTradeName" className={labelCls}>
              Nom commercial
            </label>
            <Input
              id="controllerTradeName"
              name="controllerTradeName"
              defaultValue={identite.controllerTradeName ?? ""}
            />
          </div>
        </div>

        <div>
          <label htmlFor="controllerAddressLine1" className={labelCls}>
            Adresse
          </label>
          <Input
            id="controllerAddressLine1"
            name="controllerAddressLine1"
            defaultValue={identite.controllerAddressLine1 ?? ""}
          />
        </div>

        <div>
          <label htmlFor="controllerAddressLine2" className={labelCls}>
            Complément d’adresse
          </label>
          <Input
            id="controllerAddressLine2"
            name="controllerAddressLine2"
            defaultValue={identite.controllerAddressLine2 ?? ""}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="controllerPostalCode" className={labelCls}>
              Code postal
            </label>
            <Input
              id="controllerPostalCode"
              name="controllerPostalCode"
              defaultValue={identite.controllerPostalCode ?? ""}
            />
          </div>
          <div>
            <label htmlFor="controllerCity" className={labelCls}>
              Ville
            </label>
            <Input id="controllerCity" name="controllerCity" defaultValue={identite.controllerCity ?? ""} />
          </div>
          <div>
            <label htmlFor="controllerCountryCode" className={labelCls}>
              Pays
            </label>
            <Input
              id="controllerCountryCode"
              name="controllerCountryCode"
              defaultValue={identite.controllerCountryCode ?? ""}
              placeholder="FR"
              maxLength={2}
            />
          </div>
        </div>

        <div>
          <label htmlFor="controllerSiren" className={labelCls}>
            SIREN
          </label>
          <Input
            id="controllerSiren"
            name="controllerSiren"
            defaultValue={identite.controllerSiren ?? ""}
            placeholder="9 chiffres"
            aria-describedby="siren-aide"
          />
          <p id="siren-aide" className="text-[12px] text-text-3 mt-1">
            Facultatif. Non requis pour identifier le responsable du traitement.
          </p>
        </div>

        <div>
          <label htmlFor="privacyRightsEmail" className={labelCls}>
            Adresse d’exercice des droits
          </label>
          <Input
            id="privacyRightsEmail"
            name="privacyRightsEmail"
            type="email"
            defaultValue={identite.privacyRightsEmail ?? ""}
            aria-describedby="droits-aide"
          />
          <p id="droits-aide" className="text-[12px] text-text-3 mt-1">
            Adresse à laquelle les personnes concernées pourront adresser leurs demandes.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="dpoName" className={labelCls}>
              Délégué à la protection des données
            </label>
            <Input id="dpoName" name="dpoName" defaultValue={identite.dpoName ?? ""} />
          </div>
          <div>
            <label htmlFor="dpoEmail" className={labelCls}>
              Adresse du délégué
            </label>
            <Input id="dpoEmail" name="dpoEmail" type="email" defaultValue={identite.dpoEmail ?? ""} />
          </div>
        </div>
        <p className="text-[12px] text-text-3 -mt-2">
          Facultatif. À renseigner uniquement si un délégué a été désigné.
        </p>

        <BoutonSoumettre className="self-start">Enregistrer</BoutonSoumettre>
      </FormulaireAvecEtat>
    </div>
  );
}
