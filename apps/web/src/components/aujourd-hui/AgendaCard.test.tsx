import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RendezVous } from "@/types/agenda";
import type { ContexteRendezVous } from "@/types/contexteRendezVous";
import AgendaCard from "./AgendaCard";

function rdvTest(surcharge: Partial<RendezVous> = {}): RendezVous {
  return {
    id: "rdv-test",
    heure: "09h00",
    type: "visite",
    titre: "Visite appartement Dupont",
    preparationDisponible: false,
    ...surcharge,
  };
}

// Contexte suffisamment confiant pour rendre le CTA "Préparer" disponible
// (mêmes seuils que src/lib/matching/resoudre.ts : SEUIL_FORT = 0.8, SEUIL_AMBIGU = 0.5).
function contexteConfiant(): ContexteRendezVous {
  return {
    rendezVousId: "rdv-test",
    bien: { bienId: "bien-1", confidence: 0.9, matchedBy: "reference_bien" },
    client: { clientId: "client-1", confidence: 0.9, matchedBy: "nom_complet_client" },
    typeMetier: { type: "visite", confidence: 0.9, matchedBy: "type_calendar_connu" },
    necessiteConfirmationBien: false,
    overallConfidence: 0.9,
  };
}

async function renderCard(props: Parameters<typeof AgendaCard>[0]): Promise<string> {
  const element = await AgendaCard(props);
  return renderToStaticMarkup(element);
}

describe("AgendaCard", () => {
  it("n'affiche pas de date quand dateLabel est absent (section Aujourd'hui)", async () => {
    const html = await renderCard({ rdv: rdvTest(), statut: "a_venir" });
    expect(html).toContain("09h00");
    expect(html).not.toContain("·");
  });

  it("affiche dateLabel avant l'heure (section À venir, rdv de demain)", async () => {
    const html = await renderCard({ rdv: rdvTest(), statut: "a_venir", dateLabel: "Demain" });
    expect(html).toContain("Demain");
    expect(html).toContain("09h00");
  });

  it("affiche dateLabel avec « Toute la journée » pour un événement futur journée entière", async () => {
    const rdv = rdvTest({ journeeEntiere: true, heure: "00h00" });
    const html = await renderCard({ rdv, statut: "a_venir", dateLabel: "Demain" });
    expect(html).toContain("Demain");
    expect(html).toContain("Toute la journée");
  });

  it("propose le CTA Préparer sur un rendez-vous futur si le matching est suffisamment fiable", async () => {
    const rdv = rdvTest();
    const html = await renderCard({
      rdv,
      statut: "a_venir",
      contexte: contexteConfiant(),
      dateLabel: "Demain",
    });
    expect(html).toContain("Préparer");
    expect(html).toContain(`/visites/${rdv.id}/preparer`);
  });

  it("ne propose pas le CTA Préparer si la confiance est insuffisante", async () => {
    const rdv = rdvTest();
    const contexteFaible: ContexteRendezVous = {
      rendezVousId: rdv.id,
      necessiteConfirmationBien: false,
      overallConfidence: 0.2,
    };
    const html = await renderCard({ rdv, statut: "a_venir", contexte: contexteFaible, dateLabel: "Demain" });
    expect(html).not.toContain("Préparer");
  });
});
