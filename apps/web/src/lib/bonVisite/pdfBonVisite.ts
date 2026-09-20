import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SnapshotBonVisite } from "@/types/bonVisite";

// Document final immuable (§14/§15 du brief VISIT_SIGNED_FORM_V1) — un PDF sobre, généré une seule
// fois à la signature, jamais régénéré après coup (le hash SHA-256 posé sur bonsVisite.hashDocument
// lie la preuve à cet exact fichier). Pas de design premium : une page A4, texte simple, aucune
// dépendance disproportionnée (pdf-lib est pur JS, sans binaire natif, cf. package.json).

export type DonneesPdfBonVisite = {
  contenuSnapshot: SnapshotBonVisite;
  signataire: { nomComplet: string; roleSignataire: string };
  signatureImagePng: Buffer;
  signeLe: Date;
};

const LARGEUR_A4 = 595.28;
const HAUTEUR_A4 = 841.89;
const MARGE = 56;
const LARGEUR_UTILE = LARGEUR_A4 - MARGE * 2;

function decouperEnLignes(texte: string, font: PDFFont, taille: number, largeurMax: number): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texte.split("\n")) {
    if (paragraphe === "") {
      lignes.push("");
      continue;
    }
    const mots = paragraphe.split(" ");
    let ligneCourante = "";
    for (const mot of mots) {
      const essai = ligneCourante ? `${ligneCourante} ${mot}` : mot;
      if (font.widthOfTextAtSize(essai, taille) > largeurMax && ligneCourante) {
        lignes.push(ligneCourante);
        ligneCourante = mot;
      } else {
        ligneCourante = essai;
      }
    }
    lignes.push(ligneCourante);
  }
  return lignes;
}

function formatHorodatage(date: Date): string {
  return date.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

export async function genererPdfBonVisite(donnees: DonneesPdfBonVisite): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page: PDFPage = pdf.addPage([LARGEUR_A4, HAUTEUR_A4]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = HAUTEUR_A4 - MARGE;
  const noir = rgb(0.11, 0.11, 0.11);
  const gris = rgb(0.4, 0.4, 0.4);

  const ecrireLigne = (texte: string, opts: { taille?: number; police?: PDFFont; couleur?: ReturnType<typeof rgb>; espaceApres?: number } = {}) => {
    const taille = opts.taille ?? 11;
    const police = opts.police ?? font;
    page.drawText(texte, { x: MARGE, y, size: taille, font: police, color: opts.couleur ?? noir });
    y -= taille * 1.4 + (opts.espaceApres ?? 0);
  };

  ecrireLigne("BON DE VISITE", { taille: 18, police: fontBold, espaceApres: 10 });

  for (const ligne of decouperEnLignes(donnees.contenuSnapshot.template.texte, font, 11, LARGEUR_UTILE)) {
    ecrireLigne(ligne || " ");
  }

  y -= 16;
  ecrireLigne("Signataire", { taille: 12, police: fontBold, espaceApres: 2 });
  ecrireLigne(`${donnees.signataire.nomComplet} (${donnees.signataire.roleSignataire})`);

  y -= 24;
  const signatureBytes = new Uint8Array(donnees.signatureImagePng);
  const image = await pdf.embedPng(signatureBytes);
  const largeurSignature = 200;
  const facteur = largeurSignature / image.width;
  const hauteurSignature = image.height * facteur;
  page.drawImage(image, { x: MARGE, y: y - hauteurSignature, width: largeurSignature, height: hauteurSignature });
  y -= hauteurSignature + 8;
  page.drawLine({
    start: { x: MARGE, y },
    end: { x: MARGE + largeurSignature, y },
    thickness: 0.5,
    color: gris,
  });
  y -= 14;
  ecrireLigne(`Signé le ${formatHorodatage(donnees.signeLe)}`, { taille: 9, couleur: gris });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
