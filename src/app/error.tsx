"use client";

import { Button, ErrorState } from "@/components/ui/primitives";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <ErrorState
        title="This page could not be displayed"
        message="An unexpected error interrupted rendering. Try again; if it keeps happening, check the server logs and the database connection."
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
