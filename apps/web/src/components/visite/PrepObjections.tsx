"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Objection } from "@/types/preparation";

export default function PrepObjections({ objections }: { objections: Objection[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="flex flex-col divide-y divide-[#f1f5f9] bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {objections.map((obj, i) => (
        <div key={i}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-start justify-between gap-4 px-4 py-3.5 text-left min-h-[44px]"
          >
            <p className="text-[14px] font-medium text-[#0f172a] flex-1">{obj.objection}</p>
            <ChevronDown
              size={16}
              className={`shrink-0 mt-0.5 text-[#94a3b8] transition-transform duration-150 ${open === i ? "rotate-180" : ""}`}
            />
          </button>
          {open === i && (
            <div className="px-4 pb-4">
              <p className="text-[14px] text-[#64748b] leading-relaxed border-l-2 border-[#eef2ff] pl-3">
                {obj.reponse}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
