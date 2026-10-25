import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title="Nothing here"
        action={
          <span className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/driver" variant="primary">
              Find a charger
            </ButtonLink>
            <ButtonLink href="/company">Company workspace</ButtonLink>
          </span>
        }
      >
        The page or record you asked for does not exist. It may have been removed, or the link may be incomplete.
      </EmptyState>
    </main>
  );
}
