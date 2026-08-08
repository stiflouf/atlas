import { rendezVousDuJour } from "@/data/agenda";
import type { RendezVous } from "@/types/agenda";
import { lireConnexionGoogle } from "./connexion";
import { rafraichirAccessToken } from "./oauth";
import { listerEvenements } from "./calendarClient";
import { toRendezVous } from "./adapter";

export type SourceAgenda = "google_calendar" | "demo" | "demo_erreur";

const JOURS_FENETRE = 7;

// Point d'entrée unique pour l'agenda : bascule automatiquement sur Google Calendar si une
// connexion existe, avec repli sur les données mockées si aucune connexion n'est configurée
// ou si l'appel échoue (token révoqué, API indisponible, etc.). L'appelant reste responsable
// d'afficher honnêtement la source retournée — jamais de mock présenté comme réel.
export async function getAgendaSemaine(): Promise<{ rendezVous: RendezVous[]; source: SourceAgenda }> {
  let connexion;
  try {
    connexion = await lireConnexionGoogle();
  } catch (erreur) {
    // Base de données injoignable : on ne peut même pas savoir si Google est connecté.
    // Repli silencieux sur la démo plutôt que de casser l'écran.
    console.error("[google-calendar] base de données indisponible :", erreur);
    return { rendezVous: rendezVousDuJour, source: "demo" };
  }

  if (!connexion) {
    return { rendezVous: rendezVousDuJour, source: "demo" };
  }

  try {
    const { accessToken } = await rafraichirAccessToken(connexion.refreshToken);

    const maintenant = new Date();
    const dansUneSemaine = new Date(maintenant.getTime() + JOURS_FENETRE * 24 * 60 * 60 * 1000);

    const evenements = await listerEvenements(accessToken, {
      timeMinISO: maintenant.toISOString(),
      timeMaxISO: dansUneSemaine.toISOString(),
    });

    const rendezVous: RendezVous[] = [];
    for (const event of evenements) {
      const rdv = toRendezVous(event);
      if (rdv) rendezVous.push(rdv);
    }

    return { rendezVous, source: "google_calendar" };
  } catch (erreur) {
    console.error("[google-calendar] bascule sur les données de démonstration :", erreur);
    return { rendezVous: rendezVousDuJour, source: "demo_erreur" };
  }
}
