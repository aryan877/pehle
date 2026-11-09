import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronDown, Copy } from "lucide-react";
import { forwardRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";

import { Badge, Button, Sheet, Textarea, cx, useToast } from "~/components/ui";
import type { Schemas } from "~/lib/api";
import { rupees } from "~/lib/format";

import type { ListingState } from "./queries";

type ClaimStatus = Schemas["ClaimStatus"];
type OrderStatus = Schemas["OrderStatus"];
type Tone = Parameters<typeof Badge>[0]["tone"];

const claimLabels: Record<ClaimStatus, { label: string; tone: Tone }> = {
  held: { label: "On hold", tone: "held" },
  waitlisted: { label: "In line", tone: "wait" },
  paid: { label: "Paid", tone: "info" },
  expired: { label: "Hold ran out", tone: "muted" },
  released: { label: "Gave up", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const s = claimLabels[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const orderLabels: Record<OrderStatus, { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Waiting for payment", tone: "wait" },
  payment_reported: { label: "Check payment", tone: "danger" },
  paid: { label: "Paid", tone: "held" },
  cancelled: { label: "Cancelled", tone: "muted" },
  expired: { label: "Not paid in time", tone: "muted" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = orderLabels[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const listingLabels: Record<ListingState, { label: string; tone: Tone }> = {
  ready: { label: "Ready", tone: "neutral" },
  open: { label: "Open in a drop", tone: "danger" },
  held: { label: "All held", tone: "wait" },
  sold: { label: "Sold out", tone: "held" },
};

export function ListingBadge({ state, className }: { state: ListingState; className?: string }) {
  const s = listingLabels[state];
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}

/** "₹4,500", or "Free" for giveaways. */
export function priceLabel(paise: number) {
  return paise === 0 ? "Free" : rupees(paise);
}

/** Copies text and shows a tick for a moment. */
export function CopyButton({
  text,
  label = "Copy",
  className,
  size = "sm",
  variant = "secondary",
}: {
  text: string;
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "secondary" | "ghost" | "primary";
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          toast("Copy didn't work on this device. Select the text instead.", "error");
        }
      }}
    >
      {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Marketplace-style filter chips. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx("no-scrollbar flex gap-2 overflow-x-auto", className)}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold transition",
              active ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg hover:bg-surface-3",
            )}
          >
            {o.label}
            {o.count ? (
              <span className={cx("min-w-5 rounded-full px-1.5 text-center text-[12px] leading-5", active ? "bg-accent text-white" : "bg-surface-3 text-fg-2")}>
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-4 py-3 shadow-surface">
      <p className="truncate text-[13px] font-semibold text-fg-2">{label}</p>
      <p className={cx("tabular mt-1 font-display text-[28px] font-bold leading-none", tone ?? "text-fg")}>{value}</p>
      {hint ? <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

const overlayDots: Record<ListingState, string> = { ready: "bg-fg-2", open: "bg-accent", held: "bg-gold", sold: "bg-good" };

/** The listing state on top of a photo: a dark pill with a coloured dot, readable on any image. */
export function ListingOverlay({ state, className }: { state: ListingState; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full bg-black/75 px-2 py-0.5 text-[12px] font-semibold text-white backdrop-blur", className)}>
      <span className={cx("size-1.5 rounded-full", overlayDots[state])} aria-hidden />
      {listingLabels[state].label}
    </span>
  );
}

/** The title row at the top of a studio page. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link to={back.to} className="mb-1 inline-flex items-center gap-1 text-[14px] font-semibold text-fg-2 hover:text-fg">
            <ArrowLeft className="size-4" /> {back.label}
          </Link>
        ) : null}
        <h1 className="font-display text-[26px] font-bold leading-tight sm:text-[28px]">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[15px] text-fg-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** A native select that matches Input. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cx(
          "h-12 w-full cursor-pointer appearance-none rounded-md border border-line-strong bg-surface px-3.5 pr-10 text-[15px] text-fg outline-none transition hover:border-fg-2/60 focus:border-accent focus:ring-1 focus:ring-accent",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" />
    </div>
  );
});

/** An on/off switch with a label, like Marketplace's "Hide from friends". */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
  id: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-[15px] font-semibold text-fg">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-[13px] text-muted">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", checked ? "bg-accent" : "bg-surface-3")}
      >
        <span className={cx("inline-block size-5 rounded-full bg-white shadow transition", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

/** Marketplace's thin progress bar with a label. */
export function Progress({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label ?? "Progress"}>
        <div className={cx("h-full rounded-full transition-all", done === total ? "bg-good" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      {label ? <p className="mt-1.5 text-[13px] text-muted">{label}</p> : null}
    </div>
  );
}

/** Ask for a short reason before cancelling an order. */
export function CancelOrderSheet({
  open,
  onClose,
  onConfirm,
  busy,
  itemCode,
  buyerName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
  itemCode: string;
  buyerName: string;
}) {
  const presets = ["Payment not received", "UPI reference doesn't match", "Buyer asked to cancel", "Item damaged"];
  const [reason, setReason] = useState(presets[0]!);
  return (
    <Sheet open={open} onClose={onClose} title={`Cancel ${buyerName}'s order for ${itemCode}?`}>
      <div className="space-y-4">
        <p className="text-fg-2">The next person in line is offered the item straight away.</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setReason(p)}
              className={cx(
                "rounded-full px-3 py-1.5 text-sm font-semibold transition",
                reason === p ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-2 hover:bg-surface-3",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <Textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="min-h-16" />
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            Keep order
          </Button>
          <Button variant="primary" block loading={busy} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Cancel order
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** A soft notice line: gold for warnings, accent for errors, neutral otherwise. */
export function Notice({ tone = "neutral", children, className }: { tone?: "neutral" | "warn" | "error" | "good"; children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-lg px-3 py-2.5 text-[14px]",
        tone === "warn" && "bg-gold-soft text-gold",
        tone === "error" && "bg-accent-soft font-semibold text-accent",
        tone === "good" && "bg-good-soft text-good",
        tone === "neutral" && "bg-surface-2 text-fg-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
