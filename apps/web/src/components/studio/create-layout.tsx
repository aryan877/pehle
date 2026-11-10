import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { cx } from "~/components/ui";

/**
 * Marketplace's create flow: the form replaces the left sidebar (400px at xl, with its own scroll and
 * a pinned footer for progress and save), and the main area shows a live preview. On phones the form
 * comes first, the save bar sticks to the bottom, and the preview follows.
 */
export function CreateLayout({
  crumb,
  title,
  closeTo,
  panel,
  footer,
  onSubmit,
  lead,
  children,
}: {
  /** Shown before the form on phones and above the preview on wide screens, for example the share kit. */
  lead?: ReactNode;
  crumb: ReactNode;
  title: ReactNode;
  closeTo: string;
  panel: ReactNode;
  footer: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return (
    <div className="xl:pl-[400px]">
      {lead ? (
        <section className="min-w-0 px-3 pt-4 sm:px-5 xl:px-8 xl:pt-8">
          <div className="mx-auto w-full max-w-[1000px]">{lead}</div>
        </section>
      ) : null}
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col bg-surface xl:fixed xl:bottom-0 xl:left-0 xl:top-14 xl:z-20 xl:w-[400px] xl:border-r xl:border-line"
      >
        <div className="scrollbar-thin flex-1 px-4 pb-5 pt-4 xl:overflow-y-auto">
          <div className="mb-4 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-fg-2">{crumb}</p>
              <h1 className="font-display text-[24px] font-bold leading-tight">{title}</h1>
            </div>
            <Link
              to={closeTo}
              aria-label="Close"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg hover:bg-white/15"
            >
              <X className="size-5" />
            </Link>
          </div>
          <div className="space-y-5">{panel}</div>
        </div>
        <div className="sticky bottom-0 z-10 border-t border-line bg-surface px-4 py-3 shadow-[0_-8px_16px_rgb(0_0_0/0.25)] xl:shadow-none">{footer}</div>
      </form>
      <section className={cx("min-w-0 px-3 py-6 sm:px-5 xl:px-8 xl:pb-8", lead ? "xl:pt-5" : "xl:pt-8")}>{children}</section>
    </div>
  );
}

/** A titled group of fields inside the create panel. */
export function PanelSection({ title, hint, children, className }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-3", className)}>
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The big preview card in the main area, like Marketplace's "Preview" panel. */
export function PreviewFrame({ title = "Preview", subtitle, children, aside }: { title?: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1000px] rounded-xl bg-surface p-4 shadow-surface sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {subtitle ? <p className="text-[14px] text-fg-2">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** A small caption above each preview mock. */
export function PreviewLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[13px] font-semibold text-muted">{children}</p>;
}
