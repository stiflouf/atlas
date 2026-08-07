import NavItems from "./NavItems";

export default function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-[220px] shrink-0 h-full bg-white border-r border-[#f1f5f9]">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[#f1f5f9]">
        <span className="text-[15px] font-semibold text-[#0f172a] tracking-tight">Atlas</span>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-3 py-4">
        <NavItems variant="sidebar" />
      </div>

      {/* Conseiller */}
      <div className="px-5 py-4 border-t border-[#f1f5f9]">
        <p className="text-[13px] text-[#64748b]">Steven Gausset</p>
      </div>
    </aside>
  );
}
