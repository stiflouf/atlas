export default function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">
      {children}
    </h2>
  );
}
