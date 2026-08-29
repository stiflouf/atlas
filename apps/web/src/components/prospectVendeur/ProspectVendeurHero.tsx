import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import { deriverStatutProspectVendeur, LABEL_STATUT_PROSPECT_VENDEUR } from "@/types/prospectVendeur";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import { LABEL_ORIGINE_LEAD } from "@/types/origineLead";
import { LABEL_TYPE_BIEN } from "@/types/bien";
import { joursDepuisDernierEchange } from "@/lib/prospectVendeurParcours";
import { formatMontantCentimes } from "@/types/remuneration";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function initiales(prospect: ProspectVendeur): string {
  return `${prospect.prenom?.charAt(0) ?? ""}${prospect.nom.charAt(0)}`.toUpperCase();
}

// Hero du Cockpit de prise de mandat (design validé) — deux zones parce qu'un prospect vendeur est
// exactement deux choses : une PERSONNE (gauche) et un PROJET DE VENTE (droite). Aucune photo : il
// n'existe pas de bien photographié avant la conversion, et aucune photo de personne n'est
// modélisée. Aucun score, aucune probabilité, aucune urgence — le seul chiffre relationnel affiché
// est un nombre de jours entre deux dates réelles.
//
// Pas de carte ici : la page englobe hero + rail de progression dans un seul conteneur, pour qu'ils
// se lisent comme un bloc unique.
export default function ProspectVendeurHero({ prospect }: { prospect: ProspectVendeur }) {
  const statut = deriverStatutProspectVendeur(prospect);
  const prospectReel = UUID_REGEX.test(prospect.id);
  const actif = !prospect.archiveLe && statut !== "perdu" && statut !== "mandat_signe";

  const jours = joursDepuisDernierEchange(prospect);
  const jamaisContacte = prospect.dernierContactLe === undefined;
  // Trois teintes seulement, sur la sémantique existante du design system. Aucun seuil métier n'est
  // créé ici : c'est une lecture visuelle, le vrai seuil de relance reste celui, configurable, du
  // moteur d'inactivité (ADR-033).
  const tonSilence = jours >= 30 ? "text-danger" : jours >= 7 ? "text-warning" : "text-text-3";

  // `prenom` est facultatif : un lead peut n'être connu que par son nom (ADR-027).
  const nomComplet = [prospect.prenom, prospect.nom].filter(Boolean).join(" ");
  const complementLieu = [prospect.codePostal, prospect.ville].filter(Boolean).join(" ");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]">
      {/* --- PERSONNE --- */}
      <div className="p-5 md:p-6 flex flex-col justify-between gap-4 min-w-0">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar initiales={initiales(prospect)} size={52} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="font-serif text-[21px] md:text-[24px] font-semibold text-text-1 leading-tight">
                {nomComplet}
              </h1>
              <Badge variant={statut === "perdu" ? "danger" : statut === "mandat_signe" ? "success" : "accent"}>
                {LABEL_STATUT_PROSPECT_VENDEUR[statut]}
              </Badge>
              {prospect.archiveLe && <Badge variant="muted">Archivé le {formatDate(prospect.archiveLe)}</Badge>}
            </div>

            {/* email et telephone sont tous deux facultatifs, sans invariant croisé (ADR-027) :
                chacun n'apparaît que s'il existe, jamais un tiret de remplissage. */}
            {prospect.email || prospect.telephone ? (
              <div className="flex flex-col gap-0.5">
                {prospect.email && (
                  <a href={`mailto:${prospect.email}`} className="text-[13px] text-text-2 hover:text-accent truncate">
                    {prospect.email}
                  </a>
                )}
                {prospect.telephone && (
                  <a href={`tel:${prospect.telephone}`} className="text-[13px] text-text-2 hover:text-accent">
                    {prospect.telephone}
                  </a>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-text-3">Aucune coordonnée renseignée</p>
            )}

            <p className="text-[12px] text-text-3 mt-1.5">
              {prospect.origineLead ? LABEL_ORIGINE_LEAD[prospect.origineLead] : "Origine non déterminée"}
              {prospect.origineLeadDetail && ` — ${prospect.origineLeadDetail}`}
              {" · "}Créée le {formatDate(prospect.creeLe)}
              {" · "}
              {/* Même sémantique que le bloc Relation : dernierContactLe couvre une note
                  d'interaction ET un rendez-vous tenu sans note (ADR-027) — « contact », jamais
                  « échange », qui laisserait croire qu'une note existe. */}
              <span className={`font-medium ${tonSilence}`}>
                {jamaisContacte
                  ? "jamais contacté"
                  : jours === 0
                    ? "contact aujourd'hui"
                    : `dernier contact il y a ${jours} jour${jours > 1 ? "s" : ""}`}
              </span>
            </p>
          </div>
        </div>

        {/* Actions secondaires — jamais la transition de pipeline, qui vit dans la bande navy. */}
        <div className="flex flex-wrap gap-2.5 pt-4 border-t border-border">
          {actif && prospectReel && (
            <ButtonLink href={`/taches/nouveau?prospectVendeurId=${prospect.id}`} variant="secondary" size="md">
              + Ajouter une tâche
            </ButtonLink>
          )}
          <ButtonLink href={`/prospects-vendeurs/${prospect.id}/modifier`} variant="secondary" size="md">
            Modifier
          </ButtonLink>
        </div>
      </div>

      {/* --- PROJET DE VENTE --- */}
      <div className="p-5 md:p-6 bg-surface-muted border-t lg:border-t-0 lg:border-l border-border flex flex-col gap-2.5 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Projet de vente</p>

        {/* adresseBienPotentiel (précise) et secteurBienPotentiel (approximatif) ne sont JAMAIS
            fusionnés (ADR-027) : quand seul le secteur est connu, l'interface le dit au lieu de
            laisser croire à une adresse. */}
        {prospect.adresseBienPotentiel ? (
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-text-1 leading-snug">{prospect.adresseBienPotentiel}</p>
            {complementLieu && <p className="text-[13px] text-text-2 mt-0.5">{complementLieu}</p>}
          </div>
        ) : prospect.secteurBienPotentiel ? (
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-text-2 leading-snug">{prospect.secteurBienPotentiel}</p>
            {complementLieu && <p className="text-[13px] text-text-2 mt-0.5">{complementLieu}</p>}
            <p className="text-[11px] text-text-3 mt-1">Secteur approximatif — aucune adresse précise connue</p>
          </div>
        ) : complementLieu ? (
          <p className="text-[14px] font-medium text-text-2 leading-snug">{complementLieu}</p>
        ) : (
          <p className="text-[13px] text-text-3">Aucune localisation renseignée</p>
        )}

        {prospect.typeBien && (
          <div>
            <Badge>{LABEL_TYPE_BIEN[prospect.typeBien]}</Badge>
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-border-md">
          <p className="text-[11px] text-text-3">Estimation proposée</p>
          {prospect.estimationProposeeCentimes !== undefined ? (
            <>
              <p className="font-serif text-[22px] font-semibold text-text-1 leading-none mt-1">
                {formatMontantCentimes(prospect.estimationProposeeCentimes)}
              </p>
              {prospect.estimationProposeeLe && (
                <p className="text-[11px] text-text-3 mt-1.5">le {formatDate(prospect.estimationProposeeLe)}</p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-text-3 mt-1">Pas encore chiffrée</p>
          )}
        </div>
      </div>
    </div>
  );
}
