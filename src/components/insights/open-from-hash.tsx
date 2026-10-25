"use client";

import { useEffect } from "react";

/** Opens the action item named in the URL hash (links from the overview cards). */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      const details = el?.querySelector<HTMLDetailsElement>("details[data-action-item]");
      if (details) {
        details.open = true;
        el!.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
