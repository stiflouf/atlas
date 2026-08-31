// Identité AFFICHÉE du conseiller de l'instance (DEMO-04) — strictement distincte de l'identité
// AUTHENTIFIÉE (ATLAS_ALLOWED_EMAIL, ADR-047). L'une décide qui peut entrer, l'autre seulement quel
// nom s'affiche dans la barre latérale : les confondre reviendrait à afficher une adresse email
// dans l'interface, et à faire dépendre la présentation d'un réglage de sécurité.
//
// Propriété d'INSTANCE, pas d'utilisateur : l'architecture pilote actuelle est une instance par
// conseiller (ADR-006/047), il n'existe aucune table utilisateur et ce lot n'en introduit aucune.
// Le jour où plusieurs conseillers partageront une instance, cette valeur devra venir d'une vraie
// entité utilisateur — cette fonction sera alors le point unique à remplacer.
//
// Lue côté serveur uniquement (Root Layout), jamais exposée au bundle client : aucune raison métier
// n'en fait une donnée publique, et NEXT_PUBLIC_ l'inscrirait dans le JavaScript envoyé au
// navigateur sans bénéfice.

const NOM_PAR_DEFAUT = "Conseiller DOMIORA";

// Repli neutre plutôt qu'un nom personnel : une instance fraîchement déployée doit fonctionner
// immédiatement sans afficher l'identité de quelqu'un d'autre. Absente ou vide, la variable ne fait
// jamais échouer le démarrage — contrairement aux variables de sécurité (ATLAS_SESSION_PASSWORD,
// ATLAS_ALLOWED_EMAIL), qui sont fail-closed parce qu'elles gardent un accès.
export function obtenirNomConseiller(): string {
  const configure = process.env.ATLAS_ADVISOR_DISPLAY_NAME?.trim();
  return configure ? configure.replace(/\s+/g, " ") : NOM_PAR_DEFAUT;
}

// Deux premiers mots -> deux initiales ("Bérengère Calais" -> BC). Un seul mot -> une seule
// initiale : "DOMIORA" -> "D" reste lisible, là où deux lettres d'un même mot ("DO") ressembleraient
// à une troncature. Aucune gestion de particules, de traits d'union ou de translittération : ce
// n'est qu'un avatar textuel, et sur-spécifier ici produirait des règles impossibles à justifier
// d'une langue à l'autre.
export function obtenirInitialesConseiller(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return obtenirInitialesConseiller(NOM_PAR_DEFAUT);
  return mots
    .slice(0, 2)
    .map((mot) => [...mot][0].toUpperCase())
    .join("");
}
