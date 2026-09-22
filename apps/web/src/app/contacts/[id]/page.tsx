import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import SectionTitle from "@/components/ui/SectionTitle";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import ContactFusionneFiche from "@/components/contact/ContactFusionneFiche";
import ContactsSimilairesSection from "@/components/contact/ContactsSimilairesSection";
import NoterEchangeForm, { maintenantPourDatetimeLocal } from "@/components/contact/NoterEchangeForm";
import TimelineContact from "@/components/contact/TimelineContact";
import { chargerContactDetail } from "@/lib/contactDetailRepository";
import { trouverContactsSimilaires } from "@/lib/similariteContactRepository";
import { listerContextesEchangeContact, listerTimelineContact } from "@/lib/timelineContactRepository";
import { initialesPersonne, nomComplet } from "@/lib/identite/nomPersonne";
import { LABEL_STADE_PROJET } from "@/types/client";
import { LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";
import type { RoleContact } from "@/types/rechercheContact";
import { limiteTimelineValide } from "@/types/timelineContact";

// ADR-058 — LA FICHE d'une personne : la destination canonique d'un Contact. Lecture seule : elle
// affiche ce que le read model livre et ne dérive rien (rôles, statuts, ponts vers les dossiers).
//
// Les seules actions sont des navigations vers des gestes qui existent déjà : la correction de
// l'identité canonique (`/contacts/[id]/modifier`, ADR-057), la fiche d'un dossier, mailto:, tel:.
// Aucune fusion ni suppression de Contact n'existe : aucun bouton ne le prétend.
//
// CRM_TIMELINE_V1 — « Historique » est un TROISIÈME read model (`listerTimelineContact`) : les
// interactions canoniques et les notes legacy du journal vendeur, fusionnées à la lecture, jamais
// persistées. La page en reçoit la liste déjà triée et bornée (`?timeline=`, validé serveur) et le
// seul geste d'écriture de la fiche est « Noter un échange » (NoterEchangeForm), qui écrit UNE
// interaction canonique — jamais le journal legacy (stratégie B, NO_DUAL_WRITE).
//
// Un lien vers un dossier n'est rendu que si le read model porte l'id de DOSSIER réel — jamais
// construit depuis un id de projet, que `/clients/[id]` et `/prospects-vendeurs/[id]` ne
// connaissent pas.
//
// Les Contacts partageant un email ou un téléphone (ADR-055 §H) viennent d'un second read model,
// `trouverContactsSimilaires`, calculé à chaque rendu et jamais persisté : la page ne compare
// aucune coordonnée elle-même. Son `undefined` (source introuvable) est déjà couvert par le 404
// de la fiche, qui reste maître.
//
// ADR-059 — un Contact ABSORBÉ a sa propre page (ContactFusionneFiche), rendue en HTTP 200 sans
// redirection : l'utilisateur doit comprendre où il est arrivé. Pour lui, aucun second read model
// n'est appelé — ni projets, ni similarité : tout cela appartient au survivant.
//
// Sur le survivant, « Contacts fusionnés » liste les anciennes fiches DIRECTEMENT absorbées, telles
// que le read model les lit dans le journal : nom d'alors, date, conseiller (email de session, jamais
// un identifiant technique), et un seul geste — ouvrir la fiche historique. Section absente sans
// fusion. Les coordonnées d'alors restent sur cette fiche historique, pas ici.

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }>; searchParams?: Promise<{ timeline?: string }> };

const LABEL_ROLE: Record<RoleContact, string> = {
  acquereur: "Acquéreur",
  vendeur: "Vendeur",
};

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default async function FicheContact({ params, searchParams }: PageProps) {
  const { id } = await params;
  const limiteTimeline = limiteTimelineValide((await searchParams)?.timeline);
  // ADR-054 — le périmètre vient de la session ; un contact hors périmètre est introuvable.
  const workspaceId = await exigerWorkspaceCourant();
  const resultat = await chargerContactDetail(id, workspaceId);
  if (!resultat) notFound();
  if (resultat.type === "fusionne") {
    return (
      <ContactFusionneFiche
        contact={resultat.contact}
        contactActifId={resultat.contactActifId}
        fusionneLe={resultat.fusionneLe}
      />
    );
  }

  const { detail } = resultat;
  const [contactsSimilaires, timeline, contextesEchange] = await Promise.all([
    trouverContactsSimilaires(id, workspaceId),
    listerTimelineContact(id, workspaceId, limiteTimeline),
    listerContextesEchangeContact(id, workspaceId),
  ]);
  const dateEchangeParDefaut = maintenantPourDatetimeLocal();

  const {
    contact,
    roles,
    projetsAcquereur,
    projetsVendeur,
    dossiersAcquereurContactOnly,
    dossiersVendeurContactOnly,
    fusionsAbsorbees,
  } = detail;
  const aDesDossiersContactOnly = dossiersAcquereurContactOnly.length > 0 || dossiersVendeurContactOnly.length > 0;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-4xl">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text-1 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Contacts
      </Link>

      <Card className="p-5 md:p-6 mb-8">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar initiales={initialesPersonne(contact)} size={52} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-[21px] md:text-[24px] font-semibold text-text-1 leading-tight">{nomComplet(contact)}</h1>
              {roles.map((role) => (
                <Badge key={role} variant="accent">
                  {LABEL_ROLE[role]}
                </Badge>
              ))}
            </div>
            {contact.email || contact.telephone ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
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
            ) : (
              <p className="text-[13px] text-text-3">Aucune coordonnée enregistrée</p>
            )}
            <p className="text-[12px] text-text-3 mt-0.5">Contact créé le {formatDate(contact.creeLe)}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <ButtonLink href="#noter-echange" variant="primary" size="sm">
              + Noter un échange
            </ButtonLink>
            <ButtonLink href={`/contacts/${contact.id}/modifier`} variant="secondary" size="sm">
              Modifier
            </ButtonLink>
          </div>
        </div>
      </Card>

      <ContactsSimilairesSection contactCourantId={contact.id} candidats={contactsSimilaires ?? []} />

      {fusionsAbsorbees.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Contacts fusionnés</SectionTitle>
          <p className="text-[12px] text-text-3 mb-3">Ces anciennes fiches ont été regroupées avec ce contact.</p>
          <Card>
            <ul className="divide-y divide-border-subtle">
              {fusionsAbsorbees.map((fusion) => (
                <li
                  key={fusion.fusionId}
                  className="flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-text-1">{nomComplet(fusion.identiteAbsorbee)}</span>
                    <p className="text-[12px] text-text-3">
                      Fusionné le <time dateTime={fusion.fusionneLe}>{formatDate(fusion.fusionneLe)}</time>
                      {fusion.fusionneParEmail && <> par {fusion.fusionneParEmail}</>}
                    </p>
                  </div>
                  <ButtonLink
                    href={`/contacts/${fusion.contactAbsorbeId}`}
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                  >
                    Voir le contact fusionné
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {projetsAcquereur.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Projets acquéreur</SectionTitle>
          <div className="flex flex-col gap-2">
            {projetsAcquereur.map((projet) => (
              <Card key={projet.projetId}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-text-1 tabular-nums">
                        {formatPrix(projet.budgetMin)} – {formatPrix(projet.budgetMax)}
                      </span>
                      <Badge variant="default">{LABEL_STADE_PROJET[projet.stade]}</Badge>
                      {projet.archiveLe && <Badge variant="muted">Archivé le {formatDate(projet.archiveLe)}</Badge>}
                    </div>
                    {projet.criteres.length > 0 && (
                      <p className="text-[13px] text-text-2 mt-1">{projet.criteres.join(" · ")}</p>
                    )}
                    <p className="text-[12px] text-text-3 mt-1">Projet ouvert le {formatDate(projet.creeLe)}</p>
                  </div>
                  {projet.acquereurId && (
                    <ButtonLink href={`/clients/${projet.acquereurId}`} variant="secondary" size="sm" className="shrink-0">
                      Ouvrir le dossier acquéreur
                    </ButtonLink>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {projetsVendeur.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Projets vendeur</SectionTitle>
          <div className="flex flex-col gap-2">
            {projetsVendeur.map((projet) => (
              <Card key={projet.projetId}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {projet.localisation && (
                        <span className="text-[14px] font-medium text-text-1">{projet.localisation}</span>
                      )}
                      <Badge variant="default">{LABEL_STATUT_PROSPECT_VENDEUR[projet.statut]}</Badge>
                      {projet.archiveLe && <Badge variant="muted">Archivé le {formatDate(projet.archiveLe)}</Badge>}
                    </div>
                    <p className="text-[12px] text-text-3 mt-1">Projet ouvert le {formatDate(projet.creeLe)}</p>
                  </div>
                  {projet.prospectVendeurId && (
                    <ButtonLink
                      href={`/prospects-vendeurs/${projet.prospectVendeurId}`}
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                    >
                      Ouvrir le dossier vendeur
                    </ButtonLink>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {aDesDossiersContactOnly && (
        <section className="mb-8">
          <SectionTitle>Dossiers rattachés</SectionTitle>
          <p className="text-[12px] text-text-3 mb-3">
            Dossiers reliés à cette personne sans projet canonique : ils restent suivis depuis leur fiche.
          </p>
          <div className="flex flex-col gap-2">
            {dossiersAcquereurContactOnly.map((dossier) => (
              <Card key={dossier.acquereurId}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                    <Badge variant="muted">Acquéreur</Badge>
                    <span className="text-[14px] text-text-1 tabular-nums">
                      {formatPrix(dossier.budgetMin)} – {formatPrix(dossier.budgetMax)}
                    </span>
                    <Badge variant="default">{LABEL_STADE_PROJET[dossier.stade]}</Badge>
                    {dossier.archiveLe && <Badge variant="muted">Archivé le {formatDate(dossier.archiveLe)}</Badge>}
                  </div>
                  <ButtonLink href={`/clients/${dossier.acquereurId}`} variant="secondary" size="sm" className="shrink-0">
                    Ouvrir le dossier acquéreur
                  </ButtonLink>
                </div>
              </Card>
            ))}
            {dossiersVendeurContactOnly.map((dossier) => (
              <Card key={dossier.prospectVendeurId}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                    <Badge variant="muted">Vendeur</Badge>
                    {dossier.localisation && <span className="text-[14px] text-text-1">{dossier.localisation}</span>}
                    <Badge variant="default">{LABEL_STATUT_PROSPECT_VENDEUR[dossier.statut]}</Badge>
                    {dossier.archiveLe && <Badge variant="muted">Archivé le {formatDate(dossier.archiveLe)}</Badge>}
                  </div>
                  <ButtonLink
                    href={`/prospects-vendeurs/${dossier.prospectVendeurId}`}
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                  >
                    Ouvrir le dossier vendeur
                  </ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Historique</SectionTitle>
        <Card className="p-4 md:p-5">
          {timeline.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-[13px] text-text-3">
                <MessageSquare size={15} strokeWidth={1.8} />
                Aucun échange enregistré
              </p>
              <NoterEchangeForm contactId={contact.id} contextes={contextesEchange} dateParDefaut={dateEchangeParDefaut} ouvert />
            </div>
          ) : (
            <>
              <div className="pb-4 mb-1 border-b border-border">
                <NoterEchangeForm contactId={contact.id} contextes={contextesEchange} dateParDefaut={dateEchangeParDefaut} />
              </div>
              <TimelineContact contactId={contact.id} items={timeline} limite={limiteTimeline} />
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
