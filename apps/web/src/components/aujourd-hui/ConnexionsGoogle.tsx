import type { SourceAgenda } from "@/lib/google/agendaSource";

// État des connexions Google — extrait de app/page.tsx sans changer un seul lien, une seule
// action, ni une seule règle d'affichage.
//
// Avant : quatre lignes de texte gris de 12px empilées juste sous le premier titre de section de
// l'écran le plus regardé du produit. C'était le seul endroit qui disait encore « back-office »,
// et il occupait la position la plus visible de la page.
//
// Après : une bande de pastilles, posée en PIED de la section agenda. L'information reste
// intégralement disponible et au même niveau de détail — Calendar ET Gmail sont toujours
// explicites, jamais fondus en un « Google connecté » (ADR-031-bis) — mais elle ne précède plus
// les rendez-vous.
//
// Purement présentationnel : aucune capacité n'est déduite ici, tout vient des props.
export default function ConnexionsGoogle({
  source,
  gmailAutorise,
}: {
  source: SourceAgenda;
  gmailAutorise: boolean;
}) {
  const pastille = "inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[11.5px] text-text-2";
  const point = "h-1.5 w-1.5 rounded-full shrink-0";
  const lien = "font-medium text-accent hover:text-accent-hover transition-colors";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-border pt-3">
      {source === "google_calendar" && (
        <span className={pastille}>
          <span className={`${point} bg-success`} />
          Calendar · connecté
          {/* La révocation Google est globale (ADR-031-bis) : ce bouton déconnecte aussi Gmail s'il
              a été autorisé — le libellé le dit explicitement, jamais « Déconnecter Calendar »
              seul une fois Gmail accordé. */}
          <form action="/api/auth/google/logout" method="POST" className="inline">
            <button type="submit" className={`${lien} underline`}>
              {gmailAutorise ? "Déconnecter Google (Calendar + Gmail)" : "Déconnecter"}
            </button>
          </form>
        </span>
      )}

      {source === "demo" && (
        <span className={pastille}>
          <span className={`${point} bg-warning`} />
          Calendar · démonstration
          <a href="/api/auth/google/login" className={lien}>
            Connecter
          </a>
        </span>
      )}

      {source === "demo_erreur" && (
        <span className={`${pastille} bg-warning-light text-warning`}>
          <span className={`${point} bg-warning`} />
          Calendar indisponible — données de démonstration
          <a href="/api/auth/google/login?reconnexion=1" className="font-medium underline">
            Se reconnecter
          </a>
        </span>
      )}

      {/* Capacité distincte de Calendar (ADR-031-bis) : le conseiller doit voir explicitement ce
          qui est autorisé pour l'envoi d'emails. */}
      <span className={pastille}>
        <span className={`${point} ${gmailAutorise ? "bg-success" : "bg-warning"}`} />
        Gmail · {gmailAutorise ? "autorisé" : "non autorisé"}
        {!gmailAutorise && (
          <a href="/api/auth/google/gmail/login" className={lien}>
            Autoriser
          </a>
        )}
      </span>
    </div>
  );
}
