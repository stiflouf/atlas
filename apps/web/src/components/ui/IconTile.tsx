import type { ComponentType } from "react";

// Container d'icône réutilisable (passe enrichissement visuel) — remplace les `w-10 h-10
// rounded-lg bg-accent-light` dupliqués partout (biens, clients, agenda, documents). `tone`
// contrôle uniquement la couleur de fond/icône, jamais la taille du parent.
//
// `sur-navy` (passe polish finale) : pour une icône posée SUR une surface navy — le ton `navy`
// (fond navy, glyphe champagne) y devient invisible. Champagne translucide + glyphe champagne.
type Tone = "champagne" | "navy" | "muted" | "sur-navy";
type Shape = "square" | "circle";

const TONES: Record<Tone, string> = {
  champagne: "bg-champagne-light text-champagne",
  navy: "bg-navy text-champagne",
  muted: "bg-surface-muted text-text-2",
  "sur-navy": "bg-champagne/15 text-champagne",
};

export default function IconTile({
  icon: Icon,
  tone = "champagne",
  shape = "square",
  size = 36,
  iconSize = 16,
  className = "",
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  tone?: Tone;
  shape?: Shape;
  size?: number;
  iconSize?: number;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 ${shape === "circle" ? "rounded-full" : "rounded-lg"} ${TONES[tone]} ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} strokeWidth={1.8} />
    </div>
  );
}
