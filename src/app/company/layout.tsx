import { Suspense, type ReactNode } from "react";
import { AppNav, NavFallback } from "@/components/layout/nav";

function WorkspaceNote() {
  return (
    <p className="text-xs leading-relaxed text-faint">
      Health categories describe the evidence in recorded data. They are prompts to inspect, not safety certifications.
    </p>
  );
}

/** The company (operator) workspace: sidebar navigation and wide analytical pages. */
export default function CompanyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:flex">
      <Suspense fallback={<NavFallback />}>
        <AppNav footer={<WorkspaceNote />} />
      </Suspense>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
    </div>
  );
}
