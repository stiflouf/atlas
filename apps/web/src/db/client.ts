import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Connexion créée paresseusement au premier usage réel (jamais au chargement du module) :
// les pages qui touchent la base sont déjà en rendu dynamique, donc `next build` ne les
// exécute pas — mais on évite quand même tout risque de construire le client sans
// DATABASE_URL au moment du build.
let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Variable d'environnement manquante : DATABASE_URL");
    }
    const client = postgres(connectionString, { max: 5 });
    instance = drizzle(client, { schema });
  }
  return instance;
}
