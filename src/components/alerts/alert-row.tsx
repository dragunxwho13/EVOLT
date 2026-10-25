"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Expandable alert row: the summary line toggles the explanation and evidence. */
export function AlertRow({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-sunken sm:px-5"
      >
        <div className="min-w-0 flex-1">{summary}</div>
        <ChevronDown aria-hidden className={cn("mt-1 h-4 w-4 shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div id={id} className="reveal" data-open={open} inert={!open}>
        <div>
          <div className="px-4 pb-5 sm:px-5 sm:pl-12">{children}</div>
        </div>
      </div>
    </li>
  );
}

export function AlertDetailLink({ id }: { id: string }) {
  return (
    <Link href={`/alerts/${id}`} className="text-sm font-medium text-signal hover:underline">
      Open full alert and change status
    </Link>
  );
}
