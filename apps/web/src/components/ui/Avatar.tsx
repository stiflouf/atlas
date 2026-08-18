// Avatar initiales (même patron que le bloc conseiller de Sidebar.tsx) — jamais une photo
// inventée, uniquement les initiales déjà disponibles dans les données du client.
export default function Avatar({
  initiales,
  size = 40,
  className = "",
}: {
  initiales: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full bg-navy text-champagne font-semibold ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initiales.toUpperCase()}
    </span>
  );
}
