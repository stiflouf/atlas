import { rendezVousDuJour } from "@/data/agenda";
import type { RendezVous } from "@/types/agenda";
import { lireConnexionGoogle } from "./connexion";
import { rafraichirAccessToken } from "./oauth";
import { listerEvenements } from "./calendarClient";
import { toRendezVous } from "./adapter";

export type SourceAgenda = "google_calendar" | "demo" | "demo_erreur";

const JOURS_FENETRE = 7;

// Même garde que bienRepository/clientRepository/tacheRepository : le repli mock ne doit jamais
// atteindre la production. Un conseiller réel qui n'a pas connecté Calendar voyait jusqu'ici trois
// rendez-vous fictifs (Oberkampf, Vincennes, Batignolles — data/agenda.ts) présentés dans son
// cockpit ; le badge de source restait honnête, mais des noms et des adresses inventés s'affichaient
// dans son agenda du jour. En production, l'agenda vide est la seule réponse vraie. Hors production
// (dev/tests), le repli mock reste utile et inchangé.
function estProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// Repli honnête selon l'environnement : jamais de rendez-vous inventé en production, le mock
// historique ailleurs. `source` est volontairement conservée telle quelle dans les deux cas — c'est
// elle qui porte le badge affiché à l'utilisateur (ConnexionsGoogle), et ce badge doit continuer de
// dire pourquoi l'agenda n'est pas celui de Google, que la liste soit vide ou non.
function repli(source: SourceAgenda): { rendezVous: RendezVous[]; source: SourceAgenda } {
  return { rendezVous: estProduction() ? [] : rendezVousDuJour, source };
}

// Point d'entrée unique pour l'agenda : bascule automatiquement sur Google Calendar si une
// connexion existe, avec repli si aucune connexion n'est configurée ou si l'appel échoue (token
// révoqué, API indisponible, etc.). L'appelant reste responsable d'afficher honnêtement la source
// retournée — jamais de mock présenté comme réel.
export async function getAgendaSemaine(): Promise<{ rendezVous: RendezVous[]; source: SourceAgenda }> {
  let connexion;
  try {
    connexion = await lireConnexionGoogle();
  } catch (erreur) {
    // Base de données injoignable : on ne peut même pas savoir si Google est connecté. Repli
    // silencieux plutôt que de casser l'écran — mais jamais avec des rendez-vous inventés en
    // production.
    console.error("[google-calendar] base de données indisponible :", erreur);
    return repli("demo");
  }

  if (!connexion) {
    return repli("demo");
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
    console.error("[google-calendar] Calendar indisponible, repli :", erreur);
    return repli("demo_erreur");
  }
}
