type Variant = "default" | "accent" | "danger" | "success" | "warning" | "muted";

const styles: Record<Variant, string> = {
  default: "bg-border-subtle text-text-secondary",
  accent: "bg-accent-light text-ink-900",
  danger: "bg-status-danger-subtle text-status-danger",
  success: "bg-status-success-subtle text-status-success",
  // Ajouté passe design RC2 : "à obtenir"/"à vérifier" ne sont pas des anomalies (voir ADR-029) —
  // distinct de danger, jamais un badge rouge pour l'état normal d'un dossier qui commence.
  warning: "bg-status-warning-subtle text-status-warning",
  muted: "bg-page text-text-muted",
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
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}
