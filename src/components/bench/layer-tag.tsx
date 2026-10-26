import { cn } from "@/lib/utils/cn";

export type Layer = "experimental" | "estimate" | "reference";

export const LAYER_LABELS: Record<Layer, string> = {
  experimental: "Experimental circuit",
  estimate: "Real-world estimate",
  reference: "Commercial reference",
};

export const LAYER_HINTS: Record<Layer, string> = {
  experimental: "Measured on our Arduino prototype",
  estimate: "Calculated from the prototype by a documented formula",
  reference: "Published by a standard or manufacturer",
};

const TONE: Record<Layer, string> = {
  experimental: "border-ink/30 text-ink",
  estimate: "border-signal/40 text-signal",
  reference: "border-ok/40 text-ok",
};

export function LayerTag({ layer, className }: { layer: Layer; className?: string }) {
  return (
    <span title={LAYER_HINTS[layer]} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-xs font-medium whitespace-nowrap", TONE[layer], className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", layer === "experimental" ? "bg-ink" : layer === "estimate" ? "bg-signal" : "bg-ok")} />
      {LAYER_LABELS[layer]}
    </span>
  );
}
