import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Handshake, FileSignature, Building2, ListChecks } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import IconTile from "@/components/ui/IconTile";
import Avatar from "@/components/ui/Avatar";
import TacheItem from "@/components/aujourd-hui/TacheItem";
import { getClientById } from "@/lib/clientRepository";
import { getTachesPourAcquereur } from "@/lib/tacheRepository";
import { deriverStatutTache } from "@/types/tache";
import { archiverAcquereurAction, desarchiverAcquereurAction } from "@/actions/archivageAcquereur";
import { listerOffresPourAcquereur } from "@/lib/offreRepository";
import { listerCompromisPourAcquereur } from "@/lib/compromisRepository";
import { getBienById, listerBiens } from "@/lib/bienRepository";
import { LABEL_STATUT_OFFRE } from "@/types/offre";
import { LABEL_STATUT_COMPROMIS } from "@/types/compromis";
import { evaluerCompatibiliteAcquereur } from "@/lib/compatibilite/orchestration";
import { LABEL_STATUT_COMPATIBILITE, LABEL_STATUT_CRITERE } from "@/lib/compatibilite/types";
import { listerSecteursPourAcquereur } from "@/lib/secteurRechercheRepository";
import SecteursRechercheSection from "@/components/client/SecteursRechercheSection";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stadeLabel: Record<string, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

type PageProps = { params: Promise<{ id: string }> };

// Fiche volontairement minimale — pas de tabs, pas de dossier ni d'historique (hors périmètre) :
// juste l'identité, le CTA de création de tâche, et les tâches déjà liées à cet acquéreur.
export default async function FicheClient({ params }: PageProps) {
  const { id } = await params;
  const client = await getClientById(id);
  if (!client) notFound();

  const taches = await getTachesPourAcquereur(client.id);
  const tachesAFaire = taches.filter((t) => deriverStatutTache(t) === "a_faire");
  const tachesTerminees = taches.filter((t) => deriverStatutTache(t) === "terminee");

  const offres = (await listerOffresPourAcquereur(client.id)).sort((a, b) =>
    a.dateOffre < b.dateOffre ? 1 : -1
  );
  const compromis = (await listerCompromisPourAcquereur(client.id)).sort((a, b) =>
    a.dateSignature < b.dateSignature ? 1 : -1
  );
  const bienIds = [...new Set([...offres.map((o) => o.bienId), ...compromis.map((c) => c.bienId)])];
  const biensPourOffres = await Promise.all(bienIds.map((id) => getBienById(id)));
  const biensParId = new Map(bienIds.map((id, i) => [id, biensPourOffres[i]]));

  const secteursRecherche = await listerSecteursPourAcquereur(client.id);
  const compatibilites = await evaluerCompatibiliteAcquereur(client.id);
  const biensActifs = await listerBiens();
  const biensCompatibiliteParId = new Map(biensActifs.map((b) => [b.id, b]));
  // Compatible en premier (candidats les plus actionnables), incompatible en dernier — jamais un
  // score, uniquement un ordre d'affichage sur le statut discret (même convention que BienTabs).
  const ORDRE_STATUT_COMPATIBILITE = { compatible: 0, a_verifier: 1, incompatible: 2 } as const;
  const compatibilitesTriees = [...compatibilites].sort(
    (a, b) => ORDRE_STATUT_COMPATIBILITE[a.statutGlobal] - ORDRE_STATUT_COMPATIBILITE[b.statutGlobal]
  );
  const VARIANT_PAR_STATUT_COMPATIBILITE = { compatible: "success", incompatible: "danger", a_verifier: "default" } as const;
  const VARIANT_PAR_STATUT_CRITERE = {
    compatible: "success",
    incompatible: "danger",
    a_verifier: "default",
    non_concerne: "muted",
  } as const;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Clients
      </Link>

      <div className="mb-8">
        <div className="flex items-start gap-3 mb-3">
          <Avatar initiales={`${client.prenom.charAt(0)}${client.nom.charAt(0)}`} size={44} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-[20px] md:text-[24px] font-semibold text-text-1 leading-tight">
              {client.prenom} {client.nom}
            </h1>
            <p className="text-[14px] text-text-2 mt-0.5">
              {client.email} · {client.telephone}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <span className="text-[16px] font-semibold text-text-1">
            {formatPrix(client.budgetMin)} – {formatPrix(client.budgetMax)}
          </span>
          <Badge variant="default">{stadeLabel[client.stadeProjet] ?? client.stadeProjet}</Badge>
          {client.archiveLe && <Badge variant="muted">Archivé le {formatDate(client.archiveLe)}</Badge>}
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          {!client.archiveLe && (
            <Link
              href={`/taches/nouveau?acquereurId=${client.id}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors px-3.5 py-2 rounded-lg"
            >
              + Ajouter une tâche
            </Link>
          )}
          {UUID_REGEX.test(client.id) && (
            <>
              <Link
                href={`/clients/${client.id}/modifier`}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent bg-surface border border-border-md hover:border-accent transition-colors px-3.5 py-2 rounded-lg"
              >
                Modifier
              </Link>
              <form action={client.archiveLe ? desarchiverAcquereurAction : archiverAcquereurAction}>
                <input type="hidden" name="id" value={client.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 bg-surface border border-border-md hover:border-danger hover:text-danger transition-colors px-3.5 py-2 rounded-lg"
                >
                  {client.archiveLe ? "Désarchiver" : "Archiver"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <SecteursRechercheSection
        acquereurId={client.id}
        secteursInitiaux={secteursRecherche}
        archive={!!client.archiveLe}
      />

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <IconTile icon={Handshake} tone="champagne" size={26} iconSize={13} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Offres</p>
        </div>
        {offres.length === 0 ? (
          <p className="text-[14px] text-text-3">Aucune offre pour l'instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {offres.map((offre) => {
              const bienOffre = biensParId.get(offre.bienId);
              return (
                <Card key={offre.id} className="p-4">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[13px] font-medium text-text-2">{formatDate(offre.dateOffre)}</p>
                    <span className="text-[11px] text-text-3">·</span>
                    <span className="text-[11px] font-medium text-accent">{LABEL_STATUT_OFFRE[offre.statut]}</span>
                  </div>
                  <p className="text-[14px] font-medium text-text-1">
                    {formatPrix(offre.montant)} — {bienOffre ? bienOffre.titre : "Bien indisponible"}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <IconTile icon={FileSignature} tone="champagne" size={26} iconSize={13} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Compromis</p>
        </div>
        {compromis.length === 0 ? (
          <p className="text-[14px] text-text-3">Aucun compromis pour l'instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {compromis.map((c) => {
              const bienCompromis = biensParId.get(c.bienId);
              return (
                <Card key={c.id} className="p-4">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[13px] font-medium text-text-2">{formatDate(c.dateSignature)}</p>
                    <span className="text-[11px] text-text-3">·</span>
                    <span className="text-[11px] font-medium text-accent">{LABEL_STATUT_COMPROMIS[c.statut]}</span>
                  </div>
                  <p className="text-[14px] font-medium text-text-1">
                    {formatPrix(c.prixConvenu)} — {bienCompromis ? bienCompromis.titre : "Bien indisponible"}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ADR-034 — moteur canonique et déterministe, déjà calculé côté serveur. Jamais de score,
          jamais "a_verifier" présenté comme une incompatibilité. */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <IconTile icon={Building2} tone="champagne" size={26} iconSize={13} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Biens compatibles</p>
        </div>
        {compatibilitesTriees.length === 0 ? (
          <p className="text-[14px] text-text-3">Aucun bien à comparer pour l'instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {compatibilitesTriees.map((resultat) => {
              const bienCompatible = biensCompatibiliteParId.get(resultat.bienId);
              const criteresPertinents = resultat.criteres.filter((c) => c.statut !== "non_concerne");
              return (
                <Card key={resultat.bienId} className="p-4">
                  <details>
                    <summary className="cursor-pointer flex items-center justify-between gap-3 list-none">
                      <span className="text-[14px] font-medium text-text-1">
                        {bienCompatible ? bienCompatible.titre : "Bien indisponible"}
                      </span>
                      <Badge variant={VARIANT_PAR_STATUT_COMPATIBILITE[resultat.statutGlobal]}>
                        {LABEL_STATUT_COMPATIBILITE[resultat.statutGlobal]}
                      </Badge>
                    </summary>
                    <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
                      {criteresPertinents.length === 0 ? (
                        <p className="text-[13px] text-text-3">
                          Aucune exigence structurée déclarée par cet acquéreur pour ce bien.
                        </p>
                      ) : (
                        criteresPertinents.map((critere) => (
                          <div key={critere.critere} className="flex items-start gap-2">
                            <Badge variant={VARIANT_PAR_STATUT_CRITERE[critere.statut]}>
                              {LABEL_STATUT_CRITERE[critere.statut]}
                            </Badge>
                            <p className="text-[13px] text-text-2 leading-snug">{critere.explication}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <IconTile icon={ListChecks} tone="champagne" size={26} iconSize={13} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Tâches</p>
        </div>
        {tachesAFaire.length === 0 ? (
          <p className="text-[14px] text-text-3">Aucune tâche en cours.</p>
        ) : (
          <Card className="px-4 divide-y divide-border">
            {tachesAFaire.map((tache) => (
              <TacheItem key={tache.id} tache={tache} redirectTo={`/clients/${client.id}`} />
            ))}
          </Card>
        )}
      </section>

      {tachesTerminees.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3 mb-2">Terminées</p>
          <Card className="flex flex-col divide-y divide-border px-4">
            {tachesTerminees.map((tache) => (
              <div key={tache.id} className="flex items-start gap-3 py-3">
                <div className="w-4 h-4 mt-0.5 rounded border shrink-0 bg-border border-border-md" />
                <div>
                  <p className="text-[14px] text-text-1">{tache.titre}</p>
                  {tache.contexte && <p className="text-[13px] text-text-3 mt-0.5">{tache.contexte}</p>}
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
