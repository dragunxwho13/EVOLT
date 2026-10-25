import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <EmptyState
      title="Nothing here"
      action={
        <ButtonLink href="/dashboard" variant="primary">
          Go to overview
        </ButtonLink>
      }
    >
      The page or record you asked for does not exist. It may have been removed, or the link may be incomplete.
    </EmptyState>
  );
}
