import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 select-none";
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-surface hover:bg-ink/85",
  secondary: "border border-line-strong bg-surface text-ink hover:border-ink/50 hover:bg-sunken",
  ghost: "text-muted hover:bg-sunken hover:text-ink",
  danger: "border border-inspect/40 bg-surface text-inspect hover:bg-inspect-soft",
};
const BUTTON_SIZE = { sm: "h-8 px-3", md: "h-9 px-3.5", lg: "h-10 px-4" } as const;

export function buttonClass(variant: Variant = "secondary", size: keyof typeof BUTTON_SIZE = "md", className?: string) {
  return cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof BUTTON_SIZE }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof BUTTON_SIZE }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
  as: Tag = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Removes body padding, for lists and maps that run edge to edge. */
  flush?: boolean;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={cn("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[0.95rem] font-semibold tracking-[-0.005em] text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {meta && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-2 text-[0.95rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong bg-sunken/60 px-5 py-8">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-inspect/40 bg-inspect-soft/60 px-5 py-5">
      <p className="font-semibold text-inspect">{title}</p>
      <p className="mt-1 max-w-prose text-sm text-ink">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3.5 py-2.5 text-sm",
        tone === "warn" ? "border-watch/40 bg-watch-soft text-ink" : "border-line bg-sunken text-muted",
      )}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4", className)} />;
}

export function PanelSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface p-5", className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-5 h-5 w-40" />
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={i % 2 ? "w-3/4" : "w-full"} />
        ))}
      </div>
    </div>
  );
}

export function KeyValues({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <ButtonLink size="sm" href={hrefFor(page - 1)}>
            Previous
          </ButtonLink>
        ) : (
          <Button size="sm" disabled>
            Previous
          </Button>
        )}
        {page < pages ? (
          <ButtonLink size="sm" href={hrefFor(page + 1)}>
            Next
          </ButtonLink>
        ) : (
          <Button size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </nav>
  );
}

export const inputClass =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint transition-colors hover:border-ink/40 focus-visible:border-signal";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}
