import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Handshake, FileSignature, ListChecks, Check } from "lucide-react";
import Card from "@/components/ui/Card";
import IconTile from "@/components/ui/IconTile";
import AcquereurHero from "@/components/client/AcquereurHero";
import AcquereurBrief from "@/components/client/AcquereurBrief";
import AcquereurBiensCompatibles from "@/components/client/AcquereurBiensCompatibles";
import AcquereurVisites from "@/components/client/AcquereurVisites";
import TacheItem from "@/components/aujourd-hui/TacheItem";
import SecteursRechercheSection from "@/components/client/SecteursRechercheSection";
import { getClientById } from "@/lib/clientRepository";
import { getTachesPourAcquereur } from "@/lib/tacheRepository";
import { deriverStatutTache } from "@/types/tache";
import { listerOffresPourAcquereur } from "@/lib/offreRepository";
import { listerCompromisPourAcquereur } from "@/lib/compromisRepository";
import { listerVisitesPourAcquereur } from "@/lib/visiteRepository";
import { getBienById, listerBiens } from "@/lib/bienRepository";
import { LABEL_STATUT_OFFRE } from "@/types/offre";
import { LABEL_STATUT_COMPROMIS } from "@/types/compromis";
import { evaluerCompatibiliteAcquereur } from "@/lib/compatibilite/orchestration";
import { listerSecteursPourAcquereur } from "@/lib/secteurRechercheRepository";

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ tacheTerminee?: string }> };

// Fiche Acquéreur Premium — "le brief d'achat" (design validé). Raconte un projet d'achat : qui
// (AcquereurHero), où (secteurs), où en est le projet (stade, dans le hero), quels biens
// correspondent et pourquoi (AcquereurBiensCompatibles, cœur de la page), le reste (brief, notes,
// visites, tâches, offres/compromis) en contexte autour. Pas de bandeau "Prochaine étape" : aucune
// action contextuelle unique n'est fiable ici sans construire un moteur de recommandation (hors
// périmètre explicite de ce chantier) — un bandeau absent plutôt qu'une recommandation inventée.
export default async function FicheClient({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tacheTerminee } = await searchParams;
  const client = await getClientById(id);
  if (!client) notFound();

  const taches = await getTachesPourAcquereur(client.id);
  const tachesAFaire = taches.filter((t) => deriverStatutTache(t) === "a_faire");
  const tachesTerminees = taches.filter((t) => deriverStatutTache(t) === "terminee");
  // Feedback de complétion (correctif UX) — jamais un id de requête pris tel quel : ne confirme
  // que si l'id correspond réellement à une tâche désormais terminée pour CET acquéreur, sinon
  // ignoré silencieusement (lien obsolète/copié-collé), même garde que le préremplissage de
  // /taches/nouveau. Sans ce garde-fou, un query param arbitraire pourrait afficher une fausse
  // confirmation.
  const tacheTermineeConfirmee = tachesTerminees.find((t) => t.id === tacheTerminee);

  const offres = (await listerOffresPourAcquereur(client.id)).sort((a, b) => (a.dateOffre < b.dateOffre ? 1 : -1));
  const compromis = (await listerCompromisPourAcquereur(client.id)).sort((a, b) =>
    a.dateSignature < b.dateSignature ? 1 : -1
  );
  const visites = await listerVisitesPourAcquereur(client.id);

  const bienIds = [
    ...new Set([...offres.map((o) => o.bienId), ...compromis.map((c) => c.bienId), ...visites.map((v) => v.bienId)]),
  ];
  const biensResolus = await Promise.all(bienIds.map((bienId) => getBienById(bienId)));
  const biensParId = new Map(bienIds.map((bienId, i) => [bienId, biensResolus[i]]));

  const secteursRecherche = await listerSecteursPourAcquereur(client.id);
  // ADR-034 — moteur canonique et déterministe, déjà calculé côté serveur, même sens que
  // BienAcquereursCompatibles (evaluerCompatibiliteBien) mais inversé. listerBiens() exclut déjà
  // les biens archivés (ADR-012) et porte photoPrincipaleId (sous-requête corrélée, ADR-052) —
  // jamais une seconde logique photo/filtrage ici.
  const compatibilites = await evaluerCompatibiliteAcquereur(client.id);
  const biensActifs = await listerBiens();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text-1 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        Clients
      </Link>

      <div className="mb-4">
        <AcquereurHero client={client} />
      </div>

      <div className="mb-6">
        <SecteursRechercheSection
          acquereurId={client.id}
          secteursInitiaux={secteursRecherche}
          archive={!!client.archiveLe}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Corps principal — le matching Bien × Acquéreur est le cœur de la page (design validé). */}
        <div className="flex flex-col gap-6 min-w-0">
          <AcquereurBiensCompatibles compatibilites={compatibilites} biensActifs={biensActifs} />
          <AcquereurVisites visites={visites} biensParId={biensParId} />
        </div>

        {/* Rail — brief stable, notes/critères libres, tâches, offres, compromis : contexte de
            référence, jamais le centre de l'attention. */}
        <div className="flex flex-col gap-5 min-w-0">
          <AcquereurBrief client={client} />

          {/* Notes &amp; critères libres (design validé, sections 11/13) — client.criteres est du
              texte libre jamais lu par le moteur (criteres.ts) : présenté ici comme contexte
              conseiller, jamais comme un second moteur de compatibilité. Omis entièrement si les
              deux champs sont vides — jamais une section vide pour remplir la grille. */}
          {(client.notes.trim().length > 0 || client.criteres.length > 0) && (
            <div className="bg-surface border border-border rounded-xl shadow-[0_1px_2px_rgba(18,32,56,0.04)] p-4">
              <p className="text-[13px] font-semibold text-text-1 mb-2">Notes &amp; critères complémentaires</p>
              {client.notes.trim().length > 0 && (
                <p className="text-[13px] text-text-2 leading-relaxed whitespace-pre-wrap">{client.notes}</p>
              )}
              {client.criteres.length > 0 && (
                <ul className="flex flex-col gap-1 mt-2">
                  {client.criteres.map((critere) => (
                    <li key={critere} className="flex items-start gap-2 text-[13px] text-text-1">
                      <span className="text-champagne mt-0.5 shrink-0">·</span>
                      {critere}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-text-3 mt-2">
                Texte libre — non utilisé par le moteur de compatibilité.
              </p>
            </div>
          )}

          <section>
            <div className="flex items-center gap-2 mb-2">
              <IconTile icon={ListChecks} tone="champagne" size={26} iconSize={13} />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Tâches</p>
            </div>
            {/* Feedback de complétion (correctif UX) — sans lui, cocher une tâche la fait
                disparaître instantanément de cette liste au rechargement de page qui suit
                terminerTacheAction (redirect serveur), donnant l'impression d'une suppression
                alors qu'elle est seulement déplacée ci-dessous. Pas de toast/flash message dans
                DOMIORA aujourd'hui (aucun composant de ce type dans le design system) : ce simple
                encart inline, porté par le query param déjà validé ci-dessus, reste cohérent avec
                les patrons déjà en place plutôt que d'en introduire un nouveau. */}
            {tacheTermineeConfirmee && (
              <p className="text-[13px] text-success bg-success-light rounded-lg px-3 py-2 mb-2">
                Tâche terminée : « {tacheTermineeConfirmee.titre} » — déplacée dans les tâches
                terminées ci-dessous.
              </p>
            )}
            {tachesAFaire.length === 0 ? (
              <p className="text-[13px] text-text-3">Aucune tâche en cours.</p>
            ) : (
              <Card className="px-4 divide-y divide-border">
                {tachesAFaire.map((tache) => (
                  <TacheItem
                    key={tache.id}
                    tache={tache}
                    redirectTo={`/clients/${client.id}?tacheTerminee=${tache.id}`}
                  />
                ))}
              </Card>
            )}
            {tachesTerminees.length > 0 && (
              <details className="mt-2" open={Boolean(tacheTermineeConfirmee)}>
                <summary className="text-[12px] text-text-3 hover:text-text-2 cursor-pointer select-none">
                  {tachesTerminees.length} tâche{tachesTerminees.length > 1 ? "s" : ""} terminée
                  {tachesTerminees.length > 1 ? "s" : ""} — afficher
                </summary>
                <Card className="flex flex-col divide-y divide-border px-4 mt-2">
                  {tachesTerminees.map((tache) => (
                    <div key={tache.id} className="flex items-start gap-3 py-3">
                      {/* Marqueur non interactif (correctif polish) — un carré vide bg-border
                          ressemblait trop à la case active cochable, laissant croire à une
                          réouverture possible. Aucune transition terminée → active n'existe
                          (audit) : ce span n'est ni un <button> ni un <form>, aucun onClick, rien
                          à décocher. role="img" + aria-label portent l'information sans dépendre
                          uniquement de la couleur (accessibilité) ni surcharger la ligne d'un
                          texte visible en plus de l'icône.
                          Fond plein bg-success (pas success-light) + icône claire text-surface :
                          même convention de contraste que IconTile tone="navy" (fond sombre plein,
                          icône claire) déjà validée dans le produit — success-light sur success
                          (pâle sur pâle) rendait le check à peine visible à 16px en navigateur
                          réel, un test DOM seul ne pouvait pas le révéler. */}
                      <span
                        role="img"
                        aria-label="Tâche terminée"
                        title="Tâche terminée"
                        className="w-4 h-4 mt-0.5 rounded-full shrink-0 bg-success text-surface flex items-center justify-center"
                      >
                        <Check size={12} strokeWidth={3.5} />
                      </span>
                      <div>
                        <p className="text-[14px] text-text-1">{tache.titre}</p>
                        {tache.contexte && <p className="text-[13px] text-text-3 mt-0.5">{tache.contexte}</p>}
                      </div>
                    </div>
                  ))}
                </Card>
              </details>
            )}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <IconTile icon={Handshake} tone="champagne" size={26} iconSize={13} />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Offres</p>
            </div>
            {offres.length === 0 ? (
              <p className="text-[13px] text-text-3">Aucune offre pour l&#39;instant.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {offres.map((offre) => {
                  const bienOffre = biensParId.get(offre.bienId);
                  return (
                    <Card key={offre.id} className="p-3.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[12px] font-medium text-text-2">{formatDate(offre.dateOffre)}</p>
                        <span className="text-[11px] text-text-3">·</span>
                        <span className="text-[11px] font-medium text-accent">{LABEL_STATUT_OFFRE[offre.statut]}</span>
                      </div>
                      <p className="text-[13px] font-medium text-text-1">
                        {formatPrix(offre.montant)} — {bienOffre ? bienOffre.titre : "Bien indisponible"}
                      </p>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <IconTile icon={FileSignature} tone="champagne" size={26} iconSize={13} />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Compromis</p>
            </div>
            {compromis.length === 0 ? (
              <p className="text-[13px] text-text-3">Aucun compromis pour l&#39;instant.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {compromis.map((c) => {
                  const bienCompromis = biensParId.get(c.bienId);
                  return (
                    <Card key={c.id} className="p-3.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[12px] font-medium text-text-2">{formatDate(c.dateSignature)}</p>
                        <span className="text-[11px] text-text-3">·</span>
                        <span className="text-[11px] font-medium text-accent">{LABEL_STATUT_COMPROMIS[c.statut]}</span>
                      </div>
                      <p className="text-[13px] font-medium text-text-1">
                        {formatPrix(c.prixConvenu)} — {bienCompromis ? bienCompromis.titre : "Bien indisponible"}
                      </p>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
