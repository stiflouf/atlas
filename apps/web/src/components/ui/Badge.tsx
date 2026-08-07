type Variant = "default" | "accent" | "danger" | "success" | "muted";

const styles: Record<Variant, string> = {
  default: "bg-[#f1f5f9] text-[#64748b]",
  accent: "bg-[#eef2ff] text-[#4338ca]",
  danger: "bg-[#fef2f2] text-[#dc2626]",
  success: "bg-[#f0fdf4] text-[#16a34a]",
  muted: "bg-[#f8f9fa] text-[#94a3b8]",
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
