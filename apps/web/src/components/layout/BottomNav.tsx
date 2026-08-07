import NavItems from "./NavItems";

export default function BottomNav() {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-[#f1f5f9] z-50">
      <NavItems variant="bottom" />
    </div>
  );
}
