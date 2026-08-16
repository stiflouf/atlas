import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBienById } from "@/lib/bienRepository";
import { getClientById, listerClients } from "@/lib/clientRepository";
import { getCompteRenduVisiteById, listerComptesRendusPourBien } from "@/lib/compteRenduVisiteRepository";
import { listerOffresPourBien } from "@/lib/offreRepository";
import OffreFormulaire from "@/components/offre/OffreFormulaire";

// Une requête Postgres seule n'empêche pas la génération statique (même patron que
// /taches/nouveau) : sans ce flag, le contexte préchargé figerait au moment du build.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ bienId?: string; acquereurId?: string; compteRenduVisiteId?: string }>;
};

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(montant);
}

// Route canonique de création d'Offre (ADR-044) — point d'entrée réutilisable pour un
// préremplissage contextuel (depuis une Visite réalisée) et parcours normal (sans contexte,
// depuis la fiche Bien continue d'exister séparément, inchangée). Aucune query param n'est jamais
// traitée comme un fait métier : bienId/acquereurId/compteRenduVisiteId sont systématiquement
// revalidés contre les entités réelles chargées ici, même patron que /taches/nouveau — et
// ajouterOffreAction revalide de nouveau tout, indépendamment de ce que cette page a préaffiché.
export default async function NouvelleOffrePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const bienId = params.bienId ?? "";
  const bien = bienId ? await getBienById(bienId) : undefined;

  // Sans Bien valide et non archivé, cette page contextuelle n'a rien à préremplir de fiable —
  // état honnête plutôt qu'un formulaire incomplet : le parcours normal de création reste depuis
  // la fiche Bien (ADR-044 §30/§37).
  if (!bien || bien.archiveLe) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          Aujourd&apos;hui
        </Link>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-3">Nouvelle offre</h1>
        <p className="text-[14px] text-[#64748b]">
          Aucun bien valide n&apos;est associé à cette création. Créez une offre depuis la fiche du bien concerné.
        </p>
        <Link href="/biens" className="inline-block mt-3 text-[13px] font-medium text-[#4338ca] hover:text-[#3730a3] transition-colors">
          Voir les biens
        </Link>
      </div>
    );
  }

  const [acquereurCandidat, comptesRendus, offresDuBien] = await Promise.all([
    params.acquereurId ? getClientById(params.acquereurId) : undefined,
    listerComptesRendusPourBien(bien.id),
    listerOffresPourBien(bien.id),
  ]);
  const offresEnCoursDuBien = offresDuBien.filter((o) => o.statut === "en_cours");

  // Acquéreur "verrouillable" uniquement s'il existe réellement et n'est pas archivé — sinon on
  // ignore silencieusement le préremplissage (comme /taches/nouveau) et le formulaire retombe sur
  // le parcours normal (acquéreur à choisir dans la liste complète), jamais une erreur pour un id
  // obsolète.
  const acquereurValide = acquereurCandidat && !acquereurCandidat.archiveLe ? acquereurCandidat : undefined;

  // Le compte rendu source n'est verrouillé que si TOUTE la chaîne est cohérente : il existe,
  // appartient exactement à ce bien ET à l'acquéreur verrouillé — jamais une correspondance
  // partielle ou devinée (ADR-044 §37). Un CR incohérent est simplement ignoré, pas substitué par
  // un autre.
  let compteRenduSourceId: string | undefined;
  if (acquereurValide && params.compteRenduVisiteId) {
    const compteRendu = await getCompteRenduVisiteById(params.compteRenduVisiteId);
    if (compteRendu && compteRendu.bienId === bien.id && compteRendu.acquereurId === acquereurValide.id) {
      compteRenduSourceId = compteRendu.id;
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

      <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-1">Nouvelle offre</h1>
      <p className="text-[14px] text-[#64748b] mb-6">
        {bien.titre} — Prix du bien : {formatPrix(bien.prix)}
      </p>

      {acquereurValide ? (
        <OffreFormulaire
          bienId={bien.id}
          comptesRendus={comptesRendus}
          offresEnCoursDuBien={offresEnCoursDuBien}
          verrouille={true}
          acquereur={acquereurValide}
          compteRenduSourceId={compteRenduSourceId}
        />
      ) : (
        <OffreFormulaire
          bienId={bien.id}
          comptesRendus={comptesRendus}
          offresEnCoursDuBien={offresEnCoursDuBien}
          verrouille={false}
          acquereurs={await listerClients()}
        />
      )}
    </div>
  );
}
