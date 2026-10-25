"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";

/** Copies "lat, lng" so the driver can paste it into their own navigation app. */
export function CopyCoordinates({ lat, lng }: { lat: number; lng: number }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
        Copy coordinates
      </Button>
      <span role="status" className="text-xs text-muted">
        {state === "copied" ? "Copied." : state === "failed" ? `Copy failed — select the text: ${text}` : ""}
      </span>
    </span>
  );
}
