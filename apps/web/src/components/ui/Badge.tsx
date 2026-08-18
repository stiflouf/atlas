type Variant = "default" | "accent" | "danger" | "success" | "warning" | "muted";

const styles: Record<Variant, string> = {
  default: "bg-border text-text-2",
  accent: "bg-accent-light text-accent",
  danger: "bg-danger-light text-danger",
  success: "bg-success-light text-success",
  // Ajouté passe design RC2 : "à obtenir"/"à vérifier" ne sont pas des anomalies (voir ADR-029) —
  // distinct de danger, jamais un badge rouge pour l'état normal d'un dossier qui commence.
  warning: "bg-warning-light text-warning",
  muted: "bg-page text-text-3",
};

export default function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}
