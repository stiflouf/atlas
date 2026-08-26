import Link from "next/link";
import Badge from "@/components/ui/Badge";
import type { ProfilAcquereur } from "@/types/client";
import { LABEL_STATUT_COMPATIBILITE, type ResultatCompatibilite } from "@/lib/compatibilite/types";

const VARIANT_PAR_STATUT_COMPATIBILITE = {
  compatible: "success",
  incompatible: "danger",
  a_verifier: "default",
} as const;

const ORDRE_STATUT_COMPATIBILITE = { compatible: 0, a_verifier: 1, incompatible: 2 } as const;

// Résumé d'un critère pertinent pour l'affichage en une ligne — reprend `explication` telle que
// rédigée côté serveur par le moteur (ADR-034), jamais reformulée ni transformée en score. Un seul
// extrait choisi (le premier critère pertinent), le détail complet reste dans l'onglet Contexte/
// Acquéreurs — ce bloc est un résumé, pas un remplacement du détail par critère.
function extraitExplication(resultat: ResultatCompatibilite): string | undefined {
  return resultat.criteres.find((c) => c.statut !== "non_concerne")?.explication;
}

// Bloc "Acquéreurs compatibles" (design validé Claude Design, artifact 7615625f) — même moteur,
// mêmes données que l'ancien onglet "Acquéreurs compatibles" de BienTabs (compatibilites déjà
// calculées côté serveur par evaluerCompatibiliteBien, ADR-034 §whatever — jamais recalculé ici,
// jamais de score inventé). Seule la présentation change : mis en avant au-dessus des onglets au
// lieu d'être un onglet parmi neuf, compatibles/à vérifier visibles directement, incompatibles
// repliés sous un <details> natif (aucune donnée cachée, juste un ordre de lecture).
export default function BienAcquereursCompatibles({
  compatibilites,
  acquereursActifs,
}: {
  compatibilites: ResultatCompatibilite[];
  // Même population que celle sur laquelle evaluerCompatibiliteBien() a itéré côté serveur
  // (listerClients()) — reconstruite ici uniquement pour résoudre le nom affiché, jamais pour
  // recalculer la compatibilité elle-même. Distincte de l'acquereursParId de BienTabs (limité aux
  // acquéreurs déjà en interaction sur ce bien) : la compatibilité couvre tous les actifs.
  acquereursActifs: ProfilAcquereur[];
}) {
  const acquereursParId = new Map(acquereursActifs.map((a) => [a.id, a]));
  const tries = [...compatibilites].sort(
    (a, b) => ORDRE_STATUT_COMPATIBILITE[a.statutGlobal] - ORDRE_STATUT_COMPATIBILITE[b.statutGlobal]
  );
  const visibles = tries.filter((r) => r.statutGlobal !== "incompatible");
  const masques = tries.filter((r) => r.statutGlobal === "incompatible");
  const nbCompatibles = tries.filter((r) => r.statutGlobal === "compatible").length;
  const nbAVerifier = tries.filter((r) => r.statutGlobal === "a_verifier").length;

  function ligne(resultat: ResultatCompatibilite) {
    const acquereur = acquereursParId.get(resultat.acquereurId);
    const explication = extraitExplication(resultat);
    // Initiales (design validé Claude Design, artifact ec9f41b8) — purement présentationnel,
    // dérivé du prénom/nom réels, jamais une photo ni un score : "?" uniquement quand l'acquéreur
    // n'est plus résolu (même garde que le nom "Acquéreur indisponible" ci-dessous).
    const initiales = acquereur ? `${acquereur.prenom.charAt(0)}${acquereur.nom.charAt(0)}`.toUpperCase() : "?";
    return (
      <div
        key={resultat.acquereurId}
        className="flex items-center justify-between gap-3 px-3.5 py-3 border-b border-border last:border-b-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-full bg-champagne-light text-accent text-[12px] font-semibold flex items-center justify-center shrink-0">
            {initiales}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-text-1 truncate">
              {acquereur ? `${acquereur.prenom} ${acquereur.nom}` : "Acquéreur indisponible"}
            </p>
            {explication && <p className="text-[12px] text-text-3 truncate">{explication}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Badge variant={VARIANT_PAR_STATUT_COMPATIBILITE[resultat.statutGlobal]}>
            {LABEL_STATUT_COMPATIBILITE[resultat.statutGlobal]}
          </Badge>
          {acquereur && (
            <Link href={`/clients/${acquereur.id}`} className="text-[12px] text-accent hover:text-accent-hover">
              Ouvrir →
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border-t-2 border-t-champagne border border-border rounded-xl shadow-[0_2px_8px_rgba(18,32,56,0.06)] p-4 md:p-5">
      {/* mb-3 (au lieu de mb-3.5) — polish densité : réduit légèrement la carte quand l'état vide
          ci-dessous ne tient qu'en une ligne, sans toucher au contenu affiché ni à l'accès aux
          incompatibles masqués. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-[15px] font-semibold text-text-1">Acquéreurs compatibles</p>
        <div className="flex items-center gap-1.5">
          {nbCompatibles > 0 && <Badge variant="success">{nbCompatibles} compatible{nbCompatibles > 1 ? "s" : ""}</Badge>}
          {nbAVerifier > 0 && <Badge variant="warning">{nbAVerifier} à vérifier</Badge>}
        </div>
      </div>

      {tries.length === 0 ? (
        <p className="text-[13px] text-text-3">Aucun acquéreur actif à comparer pour le moment.</p>
      ) : visibles.length === 0 ? (
        <p className="text-[13px] text-text-3">
          Aucun acquéreur compatible ou à vérifier pour l&#39;instant — {masques.length} acquéreur
          {masques.length > 1 ? "s" : ""} incompatible{masques.length > 1 ? "s" : ""}.
        </p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">{visibles.map(ligne)}</div>
      )}

      {masques.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-[12px] text-text-3 hover:text-text-2 select-none">
            {masques.length} acquéreur{masques.length > 1 ? "s" : ""} non compatible{masques.length > 1 ? "s" : ""} masqué
            {masques.length > 1 ? "s" : ""} — afficher
          </summary>
          <div className="mt-2 border border-border rounded-lg overflow-hidden">{masques.map(ligne)}</div>
        </details>
      )}
    </div>
  );
}
