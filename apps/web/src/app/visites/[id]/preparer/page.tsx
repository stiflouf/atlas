import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, User } from "lucide-react";
import Badge from "@/components/ui/Badge";
import SectionTitle from "@/components/ui/SectionTitle";
import PrepObjections from "@/components/visite/PrepObjections";
import { getPreparationPourBienEtClient } from "@/data/preparations";
import { getRendezVousAvecContexte } from "@/lib/rendezVousContexte";
import { getBienById } from "@/data/biens";
import { getClientById } from "@/data/clients";
import { formatDateISO } from "@/lib/temps";
import { geocoderAdresse } from "@/lib/geocodage/ignClient";
import { evaluerQualiteGeocodage } from "@/lib/geocodage/qualite";
import { rechercherArretsProches } from "@/lib/transports/primClient";
import { rechercherVelibProches } from "@/lib/transports/velibClient";
import { rechercherEcolesProches } from "@/lib/ecoles/annuaireEducationClient";
import type { EtablissementProche } from "@/types/ecoles";
import { rechercherCommercesProches } from "@/lib/commerces/overpassClient";
import { rechercherPatrimoineProche } from "@/lib/patrimoine/merimeeClient";
import { selectionnerElementsARaconter } from "@/lib/araconter/selectionMerimee";
import { rechercherTransactionsComparables } from "@/lib/marche/dvfClient";
import type { PreparationVisite } from "@/types/preparation";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { RendezVous } from "@/types/agenda";

type PageProps = { params: Promise<{ id: string }> };

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prix);
}

function formatPrixM2(prixM2: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(prixM2) + "/m²";
}

const stadeLabel: Record<string, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

// Utilisée quand aucune préparation curatée n'existe pour ce couple bien/acquéreur : uniquement
// des faits réels (bien, acquéreur, rendez-vous), aucune section qualitative inventée.
function construirePreparationMinimale(rdv: RendezVous, bien: Bien, acquereur: ProfilAcquereur): PreparationVisite {
  return {
    id: `contexte-${rdv.id}`,
    bien,
    acquereur,
    dateVisite: rdv.date ?? formatDateISO(new Date()),
    heureVisite: rdv.heure,
    resumeBien: bien.description,
  };
}

function EnTeteRetour() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] hover:text-[#0f172a] transition-colors mb-6"
    >
      <ArrowLeft size={14} />
      Aujourd'hui
    </Link>
  );
}

export default async function PreparerVisite({ params }: PageProps) {
  const { id } = await params;
  const resultat = await getRendezVousAvecContexte(id);
  if (!resultat) notFound();

  const { rdv, contexte } = resultat;

  if (!contexte.bien || !contexte.client) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
        <EnTeteRetour />
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mb-2">
          {rdv.titre}
        </h1>
        <p className="text-[14px] text-[#64748b] leading-relaxed">
          Atlas n'a pas pu identifier avec une confiance suffisante le bien et/ou l'acquéreur
          concernés par ce rendez-vous — aucune préparation ne peut être affichée de façon fiable.
        </p>
      </div>
    );
  }

  const bien = getBienById(contexte.bien.bienId);
  const acquereur = getClientById(contexte.client.clientId);
  if (!bien || !acquereur) notFound();

  // Géocodage de l'adresse du bien (pas celle du rendez-vous Google, potentiellement
  // différente) — best-effort, aucune coordonnée de repli si l'IGN ne répond pas.
  const adresseBien = `${bien.adresse}, ${bien.codePostal} ${bien.ville}`;
  const localisation = await geocoderAdresse(adresseBien);
  const qualiteGeocodage = localisation ? evaluerQualiteGeocodage(localisation.score) : undefined;

  // Les enrichissements géographiques ne s'exécutent que sur une localisation fiable — une
  // adresse douteuse ne doit jamais servir de base à d'autres appels.
  const [transports, velib, ecoles, commerces, patrimoine, marcheDvf] =
    qualiteGeocodage === "fiable" && localisation
      ? await Promise.all([
          rechercherArretsProches(localisation.coordonnees),
          rechercherVelibProches(localisation.coordonnees),
          rechercherEcolesProches(localisation.coordonnees),
          rechercherCommercesProches(localisation.coordonnees),
          rechercherPatrimoineProche(localisation.coordonnees, bien.codePostal),
          rechercherTransactionsComparables(localisation.coordonnees, bien.type, bien.surface),
        ])
      : [undefined, undefined, undefined, undefined, undefined, undefined];

  // Restaurants/cafés volontairement exclus de l'affichage pour l'instant (récupérés dans
  // `commerces` mais sans signal de pertinence autre que la distance).
  const groupesCommerces: { label: string; items: { nom: string; distanceMetres: number }[] }[] = commerces
    ? [
        { label: "alimentation", items: commerces.alimentation },
        { label: "boulangerie", items: commerces.boulangeries },
        { label: "pharmacie", items: commerces.pharmacies },
        { label: "marché", items: commerces.marches },
        { label: "parc", items: commerces.parcs },
        { label: "équipement sportif", items: commerces.sport },
        { label: "santé", items: commerces.sante },
      ]
    : [];

  const elementsARaconter = patrimoine
    ? selectionnerElementsARaconter(patrimoine.monuments, "Base Mérimée", patrimoine.recupereLe)
    : [];

  const groupesEcoles: { niveau: string; items: EtablissementProche[] }[] = ecoles
    ? [
        { niveau: "École", items: ecoles.ecoles },
        { niveau: "Collège", items: ecoles.colleges },
        { niveau: "Lycée", items: ecoles.lycees },
      ]
    : [];

  const prep =
    getPreparationPourBienEtClient(bien.id, acquereur.id) ?? construirePreparationMinimale(rdv, bien, acquereur);

  const { acquereur: aq, contextQuartier: quartier } = prep;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-2xl">
      {/* Retour */}
      <EnTeteRetour />

      {/* En-tête */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="accent">Préparation de visite</Badge>
          <span className="text-[13px] text-[#94a3b8]">{prep.heureVisite}</span>
        </div>
        <h1 className="text-[20px] md:text-[24px] font-semibold text-[#0f172a] leading-tight mt-2">
          {bien.titre}
        </h1>
        <p className="text-[14px] text-[#64748b] mt-0.5">{bien.adresse}, {bien.codePostal} {bien.ville}</p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <span className="text-[15px] font-semibold text-[#0f172a]">{formatPrix(bien.prix)}</span>
          <span className="text-[13px] text-[#94a3b8]">{bien.surface} m² · {bien.pieces} pièces</span>
        </div>
        {localisation && qualiteGeocodage === "fiable" && (
          <p className="text-[12px] text-[#94a3b8] mt-2">
            Localisation : {localisation.coordonnees.lat.toFixed(5)}, {localisation.coordonnees.lon.toFixed(5)}
            {" — "}
            {localisation.labelTrouve} (confiance {Math.round(localisation.score * 100)}%) · IGN Géoplateforme
          </p>
        )}
        {localisation && qualiteGeocodage !== "fiable" && (
          <div className="mt-3 bg-[#fef2f2] rounded-lg p-3">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-[#dc2626] mb-1">
              {qualiteGeocodage === "a_verifier" ? "Adresse à vérifier" : "Adresse non fiable"}
            </p>
            <p className="text-[13px] text-[#64748b] leading-snug">
              Atlas a interprété « {adresseBien} » comme « {localisation.labelTrouve} » — confiance{" "}
              {Math.round(localisation.score * 100)}%.
            </p>
          </div>
        )}
      </div>

      {/* Transports à proximité */}
      {(transports || velib) && (
        <section className="mb-8">
          <SectionTitle>Transports à proximité</SectionTitle>
          {transports && transports.arrets.length > 0 && (
            <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9] mb-2">
              {transports.arrets.map((a) => (
                <p key={a.nom} className="py-3 text-[14px] text-[#0f172a] leading-snug">
                  {(a.modes.join(" / ") || "Arrêt") + " " + a.nom}
                  {a.lignes.length > 0 &&
                    ` — ligne${a.lignes.length > 1 ? "s" : ""} ${a.lignes.join(" / ")}`}
                  {" — "}
                  {a.distanceMetres} m
                </p>
              ))}
            </div>
          )}
          {transports && (
            <p className="text-[11px] text-[#94a3b8] mb-3">
              Source : PRIM (Île-de-France Mobilités) · récupéré le{" "}
              {new Date(transports.recupereLe).toLocaleString("fr-FR")}
            </p>
          )}
          {velib && velib.stations.length > 0 && (
            <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9] mb-2">
              {velib.stations.map((s) => (
                <p key={s.nom} className="py-3 text-[14px] text-[#0f172a] leading-snug">
                  Station Vélib' {s.nom} — {s.distanceMetres} m
                </p>
              ))}
            </div>
          )}
          {velib && (
            <p className="text-[11px] text-[#94a3b8]">
              Source : Vélib' Métropole (GBFS) · récupéré le {new Date(velib.recupereLe).toLocaleString("fr-FR")}
            </p>
          )}
          {transports?.arrets.length === 0 && velib?.stations.length === 0 && (
            <p className="text-[13px] text-[#94a3b8]">Aucun arrêt ni station Vélib' à moins de 500 m.</p>
          )}
        </section>
      )}

      {/* Écoles à proximité */}
      {groupesEcoles.some(({ items }) => items.length > 0) && (
        <section className="mb-8">
          <SectionTitle>Écoles à proximité</SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9] mb-2">
            {groupesEcoles.flatMap(({ niveau, items }) =>
              items.map((e) => (
                <p key={`${niveau}-${e.nom}`} className="py-3 text-[14px] text-[#0f172a] leading-snug">
                  {niveau} {e.nom}
                  {e.statut && ` — ${e.statut}`}
                  {" — "}
                  {e.distanceMetres} m
                </p>
              ))
            )}
          </div>
          {ecoles && (
            <p className="text-[11px] text-[#94a3b8]">
              Source : Annuaire de l'Éducation Nationale · récupéré le{" "}
              {new Date(ecoles.recupereLe).toLocaleString("fr-FR")}
            </p>
          )}
        </section>
      )}

      {/* Commerces et services à proximité */}
      {groupesCommerces.some(({ items }) => items.length > 0) && (
        <section className="mb-8">
          <SectionTitle>Commerces et services à proximité</SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9] mb-2">
            {groupesCommerces.flatMap(({ label, items }) =>
              items.map((p) => (
                <p key={`${label}-${p.nom}`} className="py-3 text-[14px] text-[#0f172a] leading-snug">
                  {p.nom} — {label} — {p.distanceMetres} m
                </p>
              ))
            )}
          </div>
          {commerces && (
            <p className="text-[11px] text-[#94a3b8]">
              Source :{" "}
              <a href="https://www.openstreetmap.org/copyright" className="underline">
                © OpenStreetMap contributors
              </a>{" "}
              (ODbL) · récupéré le {new Date(commerces.recupereLe).toLocaleString("fr-FR")}
            </p>
          )}
        </section>
      )}

      {/* Patrimoine à proximité */}
      {patrimoine && patrimoine.monuments.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Patrimoine à proximité</SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9] mb-2">
            {patrimoine.monuments.map((m) => (
              <div key={m.reference} className="py-3">
                <p className="text-[14px] font-medium text-[#0f172a] leading-snug">{m.nom}</p>
                <p className="text-[12px] text-[#64748b] mt-0.5">
                  {m.type && `${m.type.charAt(0).toUpperCase()}${m.type.slice(1)}`}
                  {m.type && " · "}
                  {m.distanceMetres} m
                </p>
                {m.extraitHistorique && (
                  <p className="text-[13px] text-[#475569] leading-snug mt-1">{m.extraitHistorique}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#94a3b8]">
            Source : Ministère de la Culture — Base Mérimée · récupéré le{" "}
            {new Date(patrimoine.recupereLe).toLocaleString("fr-FR")}
          </p>
        </section>
      )}

      {/* À raconter si pertinent */}
      {elementsARaconter.length > 0 && (
        <section className="mb-8">
          <SectionTitle>À raconter si pertinent</SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9] mb-2">
            {elementsARaconter.map((e) => (
              <div key={e.reference} className="py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-1">
                  🏛 Histoire · {e.distanceMetres} m
                </p>
                <p className="text-[14px] text-[#0f172a] leading-snug">{e.texte}</p>
                <p className="text-[11px] text-[#94a3b8] mt-1">
                  Source : {e.source} — {e.reference}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Résumé du bien */}
      <section className="mb-8">
        <SectionTitle>Résumé du bien</SectionTitle>
        <p className="text-[14px] text-[#64748b] leading-relaxed">{prep.resumeBien}</p>
      </section>

      {/* Profil acquéreur */}
      <section className="mb-8 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <User size={15} className="text-[#94a3b8]" strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
            Acquéreur
          </span>
        </div>
        <p className="text-[15px] font-medium text-[#0f172a]">
          {aq.prenom} {aq.nom}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="default">{stadeLabel[aq.stadeProjet]}</Badge>
          <Badge variant="muted">
            {formatPrix(aq.budgetMin)} – {formatPrix(aq.budgetMax)}
          </Badge>
        </div>
        {aq.criteres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {aq.criteres.map((c) => (
              <span key={c} className="text-[12px] bg-[#f8f9fa] text-[#64748b] px-2 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
        )}
        {aq.notes && (
          <p className="text-[13px] text-[#94a3b8] mt-3 leading-relaxed border-t border-[#f1f5f9] pt-3">
            {aq.notes}
          </p>
        )}
      </section>

      {/* Points forts */}
      {prep.pointsForts && prep.pointsForts.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Points forts à mettre en valeur</SectionTitle>
          <div className="flex flex-col gap-2">
            {prep.pointsForts.map((point, i) => (
              <div key={i} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start gap-3">
                <span className="text-[#4338ca] font-medium shrink-0 mt-0.5">·</span>
                <p className="text-[14px] text-[#0f172a] leading-snug">{point}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Vigilances */}
      {prep.vigilances && prep.vigilances.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Points de vigilance</SectionTitle>
          <div className="flex flex-col gap-2">
            {prep.vigilances.map((v, i) => (
              <div key={i} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start gap-3">
                <span className="text-[#dc2626] shrink-0 mt-0.5 text-[13px] font-medium">!</span>
                <p className="text-[14px] text-[#64748b] leading-snug">{v}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Questions */}
      {prep.questionsASuggerer && prep.questionsASuggerer.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Questions à poser</SectionTitle>
          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 divide-y divide-[#f1f5f9]">
            {prep.questionsASuggerer.map((q, i) => (
              <p key={i} className="py-3 text-[14px] text-[#0f172a] leading-snug">
                {q}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Objections */}
      {prep.objectionsProbables && prep.objectionsProbables.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Objections probables</SectionTitle>
          <PrepObjections objections={prep.objectionsProbables} />
        </section>
      )}

      {/* Contexte quartier */}
      {quartier && quartier.description && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={13} className="text-[#94a3b8]" strokeWidth={1.8} />
            <SectionTitle>Quartier</SectionTitle>
          </div>
          <p className="text-[14px] text-[#64748b] leading-relaxed mb-4">{quartier.description}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Transports</p>
              {quartier.transports.map((t) => (
                <p key={t} className="text-[13px] text-[#0f172a] py-0.5">{t}</p>
              ))}
            </div>
            <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Commerces</p>
              {quartier.commerces.map((c) => (
                <p key={c} className="text-[13px] text-[#0f172a] py-0.5">{c}</p>
              ))}
            </div>
            <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">Écoles</p>
              {quartier.ecoles.map((e) => (
                <p key={e} className="text-[13px] text-[#0f172a] py-0.5">{e}</p>
              ))}
            </div>
            {quartier.pointsAttention.length > 0 && (
              <div className="bg-[#fef2f2] rounded-lg p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#dc2626] mb-2">À mentionner</p>
                {quartier.pointsAttention.map((p) => (
                  <p key={p} className="text-[13px] text-[#64748b] py-0.5">{p}</p>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Marché — transactions réelles à proximité, jamais une estimation */}
      {marcheDvf && marcheDvf.transactions.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Marché</SectionTitle>
          <p className="text-[13px] text-[#94a3b8] mb-3 leading-relaxed">
            Transactions de vente réellement enregistrées à proximité, de surface comparable — des
            références de marché pour le conseiller, pas une estimation du bien.
          </p>

          <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-3">
            <p className="text-[11px] text-[#94a3b8] uppercase tracking-wider">Prix affiché de ce bien</p>
            <p className="text-[16px] font-semibold text-[#4338ca] mt-0.5">
              {formatPrixM2(Math.round(bien.prix / bien.surface))}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {marcheDvf.transactions.map((t) => (
              <div
                key={t.reference}
                className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#64748b]">
                    {t.surfaceM2.toFixed(0)} m² · {t.distanceMetres} m
                  </p>
                  <p className="text-[11px] text-[#94a3b8] mt-0.5">
                    Vendu le{" "}
                    {new Date(t.dateVente).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-medium text-[#0f172a]">{formatPrix(t.prixVente)}</p>
                  <p className="text-[11px] text-[#94a3b8]">{formatPrixM2(t.prixM2)}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#94a3b8] mt-2">
            Source : {marcheDvf.source} · récupéré le {new Date(marcheDvf.recupereLe).toLocaleString("fr-FR")}
          </p>
        </section>
      )}

      {/* Contexte humain — à raconter si pertinent */}
      {prep.contexteHumain && prep.contexteHumain.length > 0 && (
        <section className="mb-8">
          <SectionTitle>À raconter si pertinent</SectionTitle>
          <p className="text-[13px] text-[#94a3b8] mb-3 leading-relaxed">
            Quelques repères de contexte — à utiliser ou non, selon la manière dont se passe la visite.
          </p>
          <div className="flex flex-col gap-2">
            {prep.contexteHumain.map((item, i) => (
              <div key={i} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3">
                <p className="text-[14px] text-[#64748b] leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Rappel du principe Atlas */}
      <p className="text-[12px] text-[#94a3b8] leading-relaxed border-t border-[#f1f5f9] pt-4 mb-6">
        Ces éléments sont des suggestions pour vous aider à préparer la visite — ils ne remplacent ni
        votre jugement, ni la relation que vous construisez avec l'acquéreur.
      </p>
    </div>
  );
}
