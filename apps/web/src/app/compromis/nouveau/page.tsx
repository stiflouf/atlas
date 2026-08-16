import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBienById } from "@/lib/bienRepository";
import { getClientById, listerClients } from "@/lib/clientRepository";
import { getOffreById, listerOffresPourBien } from "@/lib/offreRepository";
import { listerCompromisPourBien, getCompromisParOffreId } from "@/lib/compromisRepository";
import CompromisFormulaire from "@/components/compromis/CompromisFormulaire";

// Une requête Postgres seule n'empêche pas la génération statique (même patron que
// /taches/nouveau et /offres/nouveau) : sans ce flag, le contexte préchargé figerait au moment du
// build.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ bienId?: string; acquereurId?: string; offreId?: string }>;
};

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(montant);
}

function EtatHonnete({ bienId, titre, message }: { bienId?: string; titre: string; message: string }) {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={bienId ? `/biens/${bienId}` : "/"}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {bienId ? "Retour au bien" : "Aujourd'hui"}
      </Link>
      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-3">{titre}</h1>
      <p className="text-[14px] text-[#64748b]">{message}</p>
      {!bienId && (
        <Link href="/biens" className="inline-block mt-3 text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
          Voir les biens
        </Link>
      )}
    </div>
  );
}

// Route canonique de création de Compromis (ADR-045) — même principe que /offres/nouveau
// (ADR-044) : préremplissage contextuel depuis une Offre acceptée, jamais une confiance dans les
// query params. bienId/acquereurId/offreId sont systématiquement revalidés contre les entités
// réelles chargées ici ; ajouterCompromisAction revalide de nouveau tout, indépendamment de ce que
// cette page a préaffiché (protection contre un POST forgé et contre une Offre qui aurait changé
// d'état entre le GET et le submit).
export default async function NouveauCompromisPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const bienId = params.bienId ?? "";
  const bien = bienId ? await getBienById(bienId) : undefined;

  if (!bien || bien.archiveLe) {
    return (
      <EtatHonnete
        titre="Nouveau compromis"
        message="Aucun bien valide n'est associé à cette création. Créez un compromis depuis la fiche du bien concerné."
      />
    );
  }

  // Garde "un seul compromis en_cours par bien" (ADR-016, inchangée) — détectée ici pour ne
  // jamais afficher un formulaire voué à échouer, la garde reste par ailleurs strictement
  // appliquée par ajouterCompromisAction indépendamment de cet affichage.
  const compromisDuBien = await listerCompromisPourBien(bien.id);
  if (compromisDuBien.some((c) => c.statut === "en_cours")) {
    return (
      <EtatHonnete
        bienId={bien.id}
        titre="Nouveau compromis"
        message="Un compromis est déjà en cours pour ce bien — résolvez-le avant d'en créer un nouveau."
      />
    );
  }

  const [acquereurCandidat, offresDuBien] = await Promise.all([
    params.acquereurId ? getClientById(params.acquereurId) : undefined,
    listerOffresPourBien(bien.id),
  ]);
  const offresAcceptees = offresDuBien.filter((o) => o.statut === "acceptee");

  // Acquéreur "verrouillable" uniquement s'il existe réellement et n'est pas archivé — sinon
  // préremplissage ignoré silencieusement (comme /taches/nouveau et /offres/nouveau), retombe sur
  // la sélection libre.
  const acquereurValide = acquereurCandidat && !acquereurCandidat.archiveLe ? acquereurCandidat : undefined;

  // L'Offre n'est verrouillable que si TOUTE la chaîne est cohérente : elle existe, appartient
  // exactement à ce bien ET à l'acquéreur déjà verrouillé, et est bien 'acceptee' — jamais une
  // correspondance partielle ou devinée (ADR-045 §7). Une Offre incohérente est simplement
  // ignorée, jamais substituée par une autre offre acceptée du bien.
  let offreValide: Awaited<ReturnType<typeof getOffreById>> | undefined;
  if (acquereurValide && params.offreId) {
    const offreCandidate = await getOffreById(params.offreId);
    if (
      offreCandidate &&
      offreCandidate.bienId === bien.id &&
      offreCandidate.acquereurId === acquereurValide.id &&
      offreCandidate.statut === "acceptee"
    ) {
      offreValide = offreCandidate;
    }
  }

  // Offre déjà utilisée comme origine d'un autre compromis (ADR-045 §16-17, garde applicative
  // stricte, aucune confirmation possible pour la contourner) — état honnête plutôt qu'un
  // formulaire voué à échouer. Aucun lien vers une fiche Compromis : elle n'existe pas.
  if (offreValide) {
    const compromisExistantPourOffre = await getCompromisParOffreId(offreValide.id);
    if (compromisExistantPourOffre) {
      return (
        <EtatHonnete
          bienId={bien.id}
          titre="Nouveau compromis"
          message="Cette offre est déjà associée à un compromis."
        />
      );
    }
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      <Link
        href={`/biens/${bien.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {bien.titre}
      </Link>

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-1">Nouveau compromis</h1>
      <p className="text-[14px] text-[#64748b] mb-6">
        {bien.titre} — {formatPrix(bien.prix)}
      </p>

      {acquereurValide && offreValide ? (
        <CompromisFormulaire bienId={bien.id} verrouille={true} acquereur={acquereurValide} offre={offreValide} />
      ) : (
        <CompromisFormulaire
          bienId={bien.id}
          verrouille={false}
          acquereurs={await listerClients()}
          offresAcceptees={offresAcceptees}
        />
      )}
    </div>
  );
}
