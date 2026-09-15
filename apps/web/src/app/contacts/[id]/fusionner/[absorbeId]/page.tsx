import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fusionnerContactsAction } from "@/actions/fusionnerContacts";
import FusionContactsFormulaire, { type CodeRefusAffichable } from "@/components/contact/FusionContactsFormulaire";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { preparerFusionContacts } from "@/lib/preparationFusionContactRepository";
import { CHAMPS_IDENTITE_CONTACT, type ChampIdentiteContact } from "@/types/contactFusion";

// ADR-059 — la page de FUSION : `/contacts/[id]/fusionner/[absorbeId]` encode la direction — le
// premier id est le contact CONSERVÉ, le second le contact ABSORBÉ — et « Inverser » n'est qu'une
// navigation vers l'URL symétrique. Lecture seule ici : tout vient du read model de préparation,
// l'unique écriture est la Server Action, appelée par le formulaire.
//
// La similarité n'est pas une autorisation : deux contacts sans coordonnée commune peuvent être
// ouverts ici par URL. Un contact hors périmètre ou identique à lui-même est introuvable ; un
// contact déjà absorbé donne un état explicite, sans formulaire.

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; absorbeId: string }>;
  searchParams: Promise<{ fusion?: string; champ?: string }>;
};

const CODES_REFUS: readonly CodeRefusAffichable[] = [
  "confirmation_requise",
  "choix_manquant",
  "deja_fusionne",
  "identite_modifiee_entre_temps",
  "choix_identite_invalide",
  "avertissement_requis",
  "page_perimee",
];

export default async function FusionnerContactsPage({ params, searchParams }: PageProps) {
  const { id: survivantId, absorbeId } = await params;
  const { fusion, champ } = await searchParams;
  // ADR-054 — le périmètre vient de la session ; hors périmètre = introuvable.
  const workspaceId = await exigerWorkspaceCourant();
  const preparation = await preparerFusionContacts({ workspaceId, contactSurvivantId: survivantId, contactAbsorbeId: absorbeId });
  if (preparation.statut === "contact_introuvable" || preparation.statut === "meme_contact") notFound();

  const refus = CODES_REFUS.find((code) => code === fusion);
  const champRefus = CHAMPS_IDENTITE_CONTACT.find((c) => c === champ) as ChampIdentiteContact | undefined;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-4xl">
      <Link
        href={`/contacts/${survivantId}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text-1 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Retour au contact
      </Link>
      <h1 className="text-[21px] md:text-[24px] font-semibold text-text-1 leading-tight mb-1">Fusionner deux contacts</h1>
      <p className="text-[13px] text-text-3 mb-6">
        Réunir deux fiches qui décrivent la même personne. Le contact conservé garde son identifiant ; le contact absorbé
        reste consultable mais n’est plus actif.
      </p>

      {preparation.statut === "deja_fusionne" ? (
        <Card className="p-5">
          <p className="text-[14px] font-medium text-text-1 mb-1">Ce contact n’est plus actif.</p>
          <p className="text-[13px] text-text-2 mb-4">
            Un des deux contacts a déjà été fusionné : aucune fusion n’est possible depuis cette page.
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/contacts/${survivantId}`} variant="secondary" size="sm">
              Voir le premier contact
            </ButtonLink>
            <ButtonLink href={`/contacts/${absorbeId}`} variant="secondary" size="sm">
              Voir le second contact
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <FusionContactsFormulaire
          preparation={preparation}
          action={fusionnerContactsAction}
          refus={refus}
          champRefus={champRefus}
        />
      )}
    </div>
  );
}
