import Link from "next/link";
import Badge from "@/components/ui/Badge";
import { LIMITE_TIMELINE_MAX, PAS_TIMELINE, libelleEchange, type ItemTimelineContact } from "@/types/timelineContact";

function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// CRM_TIMELINE_V1 — l'historique d'une personne, tel que le read model le livre : déjà fusionné,
// déjà trié, déjà borné. Ce composant n'ordonne rien et ne dédoublonne rien. « Afficher plus »
// recharge la page avec une borne supérieure (`?timeline=`), validée serveur.
export default function TimelineContact({
  contactId,
  items,
  limite,
}: {
  contactId: string;
  items: ItemTimelineContact[];
  limite: number;
}) {
  const peutAfficherPlus = items.length >= limite && limite < LIMITE_TIMELINE_MAX;
  return (
    <div className="flex flex-col">
      {items.map((item, index) => {
        const dernier = index === items.length - 1;
        return (
          <div key={`${item.source}-${item.id}`} className="flex gap-3 py-2.5">
            <div className="flex flex-col items-center w-5 shrink-0">
              <span
                className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                  item.type === "note" ? "bg-surface border border-border-md" : "bg-champagne"
                }`}
              />
              {!dernier && <span className="w-px flex-1 bg-border mt-1.5" />}
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-1 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-medium text-text-1">{libelleEchange(item.type, item.sens)}</span>
                {item.natureMetier === "retour_vendeur_post_visite" && <Badge variant="accent">Retour vendeur</Badge>}
                {item.source === "note_legacy" && <Badge variant="muted">Journal vendeur</Badge>}
                <time dateTime={item.survenuLe} className="text-[11.5px] text-text-3 tabular-nums">
                  {formatDateHeure(item.survenuLe)}
                </time>
              </div>
              {item.sujet && <p className="text-[13px] font-medium text-text-2">Objet : {item.sujet}</p>}
              {item.contenu && <p className="text-[13px] text-text-2 leading-relaxed whitespace-pre-line break-words">{item.contenu}</p>}
              {item.contexte && (
                <Link href={item.contexte.href} className="text-[12px] text-accent hover:text-accent-hover self-start">
                  {item.contexte.libelle}
                </Link>
              )}
            </div>
          </div>
        );
      })}
      {peutAfficherPlus && (
        <Link
          href={`/contacts/${contactId}?timeline=${limite + PAS_TIMELINE}`}
          className="self-start mt-2 text-[13px] font-medium text-accent hover:text-accent-hover"
        >
          Afficher plus
        </Link>
      )}
    </div>
  );
}
