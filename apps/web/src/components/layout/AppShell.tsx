import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full bg-[#f8f9fa]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto pb-14 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
