import { inflateSync } from "node:zlib";

// Utilitaire de TEST uniquement — aucun chemin de production ne l'importe (suffixe `DeTest`, même
// convention de nommage que les autres raccourcis de test du dépôt, et pas un fichier `.test.ts`
// car deux suites distinctes l'importent). Vérifier qu'une mention figure RÉELLEMENT dans le PDF signé
// demande de le relire comme un lecteur le verrait : pdf-lib compresse les flux de contenu
// (FlateDecode) et écrit les chaînes dessinées en hexadécimal (`<4D41…> Tj`), donc un `includes`
// sur les octets bruts ne prouve rien — ni dans un sens, ni dans l'autre.
//
// Volontairement minimal : seuls les opérateurs `Tj` sont décodés, en WinAnsi (l'encodage des
// StandardFonts utilisées par pdfBonVisite.ts). Ce n'est pas un extracteur PDF générique.
export function texteVisiblePdfDeTest(pdf: Buffer): string {
  const brut = pdf.toString("latin1");
  const entetesStream = /\/Length (\d+)\s*>>\s*stream\r?\n/g;
  let texte = "";
  let entete: RegExpExecArray | null;
  while ((entete = entetesStream.exec(brut)) !== null) {
    const debut = entete.index + entete[0].length;
    const flux = pdf.subarray(debut, debut + Number(entete[1]));
    let contenu: string;
    try {
      contenu = inflateSync(flux).toString("latin1");
    } catch {
      continue;
    }
    for (const [, hex] of contenu.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      texte += `${Buffer.from(hex, "hex").toString("latin1")}\n`;
    }
  }
  return texte;
}
