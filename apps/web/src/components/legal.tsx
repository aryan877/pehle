import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const CONTACT_EMAIL = "aryankumar877@gmail.com";

/** The body of a plain reading page (privacy policy, terms); the route wraps it in the app shell. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-5 py-6 text-[15px] leading-relaxed text-fg-2 [&_h2]:pt-2 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc">
      <header className="space-y-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-fg">{title}</h1>
        <p className="text-[13px] text-muted">Last updated {updated}</p>
      </header>
      {children}
      <p>
        Questions:{" "}
        <a className="font-semibold text-info hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </article>
  );
}

/** "By continuing you agree…" line for sign-in. */
export function LegalNote({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <p className="text-center text-[12px] text-muted">
      By continuing you agree to the{" "}
      <Link to="/terms" onClick={onNavigate} className="underline hover:text-fg">
        terms
      </Link>{" "}
      and{" "}
      <Link to="/privacy" onClick={onNavigate} className="underline hover:text-fg">
        privacy policy
      </Link>
      .
    </p>
  );
}
