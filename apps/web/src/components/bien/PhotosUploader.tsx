"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ajouterPhotoBienAction } from "@/actions/ajouterPhotoBien";

// Sélection multiple côté UX, mais une Server Action par fichier (ADR-052 §10/§24) — jamais les N
// fichiers dans une seule requête. Concurrence limitée à 2 : réactif sans saturer le serveur d'un
// pilote mono-conseiller. Un échec sur un fichier n'annule jamais ceux déjà envoyés avec succès —
// chaque ligne garde son propre statut, affiché indépendamment.
const CONCURRENCE_MAX = 2;

type Statut = "en_attente" | "en_cours" | "succes" | "erreur";
type EtatFichier = { id: string; nom: string; statut: Statut; message?: string };

export default function PhotosUploader({ bienId, placesRestantes }: { bienId: string; placesRestantes: number }) {
  const router = useRouter();
  const [fichiers, setFichiers] = useState<EtatFichier[]>([]);
  const [enCours, setEnCours] = useState(false);

  async function envoyerUnFichier(file: File, id: string): Promise<void> {
    setFichiers((prev) => prev.map((f) => (f.id === id ? { ...f, statut: "en_cours" } : f)));
    const formData = new FormData();
    formData.set("bienId", bienId);
    formData.set("fichier", file);

    try {
      const resultat = await ajouterPhotoBienAction(formData);
      setFichiers((prev) =>
        prev.map((f) =>
          f.id === id
            ? resultat.succes
              ? { ...f, statut: "succes" }
              : { ...f, statut: "erreur", message: resultat.erreur }
            : f
        )
      );
    } catch {
      setFichiers((prev) =>
        prev.map((f) => (f.id === id ? { ...f, statut: "erreur", message: "Échec inattendu, réessayez." } : f))
      );
    }
  }

  async function onChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const selection = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selection.length === 0) return;

    const aTraiter = selection.slice(0, Math.max(0, placesRestantes));
    const entrees: EtatFichier[] = aTraiter.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      nom: file.name,
      statut: "en_attente",
    }));
    setFichiers((prev) => [...prev, ...entrees]);
    setEnCours(true);

    let curseur = 0;
    async function worker(): Promise<void> {
      while (curseur < aTraiter.length) {
        const index = curseur++;
        await envoyerUnFichier(aTraiter[index], entrees[index].id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCE_MAX, aTraiter.length) }, worker));

    setEnCours(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        className={`inline-flex w-fit items-center gap-1.5 text-[13px] font-medium transition-colors px-3.5 py-2 rounded-lg border ${
          enCours || placesRestantes <= 0
            ? "text-text-disabled bg-surface-muted border-border cursor-not-allowed"
            : "text-accent bg-surface border-border-md hover:border-accent cursor-pointer"
        }`}
      >
        + Ajouter des photos
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={enCours || placesRestantes <= 0}
          onChange={onChange}
        />
      </label>

      {fichiers.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {fichiers.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-[12.5px]">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  f.statut === "succes" ? "bg-success" : f.statut === "erreur" ? "bg-danger" : "bg-text-3"
                }`}
              />
              <span className="truncate text-text-2 max-w-[220px]">{f.nom}</span>
              {f.statut === "en_cours" && <span className="text-text-3">envoi…</span>}
              {f.statut === "erreur" && <span className="text-danger">{f.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
