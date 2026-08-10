// Distingue ce qui est présenté comme un fait sourcé de ce qui serait un jour présenté comme une
// légende ou un mythe local — jamais les deux avec le même niveau de certitude. Pour l'instant,
// seul `fait_historique` est alimenté (via la Base Mérimée) ; `legende` et `mythe` sont prévus
// dans l'architecture mais n'ont aucune source ni pipeline pour le moment.
export type NatureRecit = "fait_historique" | "patrimoine" | "legende" | "mythe";

export type ElementARaconter = {
  nature: NatureRecit;
  titre: string; // nom du monument/lieu concerné
  texte: string; // phrase(s) extraites verbatim de la source, jamais reformulées
  distanceMetres: number;
  reference: string; // référence officielle de la notice source
  source: string;
  recupereLe: string;
};
