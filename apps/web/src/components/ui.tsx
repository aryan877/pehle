import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import { initials } from "~/lib/format";

export { clsx as cx };

type Variant = "primary" | "secondary" | "ghost" | "success" | "danger" | "dark";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-white/10 text-fg hover:bg-white/15",
  ghost: "text-fg-2 hover:bg-white/10 hover:text-fg",
  success: "bg-good text-white hover:brightness-110",
  danger: "bg-transparent text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent-soft",
  dark: "bg-fg text-canvas hover:bg-fg-2",
};

/** Marketplace geometry: 8px corners, 36px default height. */
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-md gap-1.5",
  md: "h-9 px-4 text-[15px] rounded-lg gap-2",
  lg: "h-11 px-5 text-[15px] rounded-lg gap-2",
  xl: "h-13 px-6 text-base rounded-xl gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex select-none items-center justify-center font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-xl bg-surface shadow-surface", className)}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-fg-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-accent">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-fg placeholder:text-muted outline-none transition hover:border-fg-2/60 focus:border-accent focus:ring-1 focus:ring-accent";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(inputClass, "h-12", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={clsx(inputClass, "min-h-24 resize-y", className)} {...rest} />;
});

type Tone = "neutral" | "live" | "held" | "wait" | "info" | "muted" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-2 border-transparent",
  live: "bg-live text-white border-live uppercase tracking-wide",
  held: "bg-good-soft text-good border-good/25",
  wait: "bg-gold-soft text-gold border-gold/25",
  info: "bg-info-soft text-info border-info/25",
  muted: "bg-surface-2 text-muted border-line",
  danger: "bg-accent-soft text-accent border-accent/25",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[1px] text-[12px] font-semibold leading-[18px]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={clsx("relative inline-flex size-2", className)} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/80" />
      <span className="relative inline-flex size-2 rounded-full bg-white" />
    </span>
  );
}

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export function CodeChip({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md bg-gold px-1.5 py-[1px] font-mono text-[12px] font-extrabold tracking-wide text-canvas",
        className,
      )}
    >
      {code}
    </span>
  );
}

/** Stable, readable colour per person, like Twitch usernames. */
export const NAME_COLOURS = ["#ff7ab6", "#ffc233", "#5ee3a1", "#6cb2ff", "#c39bff", "#ff9a5c", "#4fd6e0", "#f5e663"];
export function colourFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return NAME_COLOURS[h % NAME_COLOURS.length]!;
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, background: src ? undefined : colourFor(name) };
  if (src) return <img src={src} alt="" style={style} className={clsx("rounded-full object-cover", className)} />;
  return (
    <span
      style={style}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-canvas",
        size < 32 ? "text-[11px]" : "text-sm",
        className,
      )}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <p className="font-semibold text-fg">{title}</p>
      {children ? <div className="max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** False for steps the user must complete, such as joining a room. */
  dismissible?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => dismissible && e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button
        aria-label="Close"
        tabIndex={dismissible ? 0 : -1}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "relative max-h-[92dvh] w-full animate-rise overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-safe shadow-lift outline-none sm:rounded-3xl sm:p-6",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-xl font-semibold text-fg">
            {title}
          </h2>
          {dismissible ? (
            <button onClick={onClose} className="-m-1 rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Close">
              <X className="size-5" />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Milliseconds until `until`, updated every half second. */
export function useCountdown(until: string | null | undefined): number {
  const target = until ? new Date(until).getTime() : 0;
  const [left, setLeft] = useState(() => (target ? target - Date.now() : 0));
  useEffect(() => {
    if (!target) return;
    setLeft(target - Date.now());
    const id = window.setInterval(() => setLeft(target - Date.now()), 500);
    return () => window.clearInterval(id);
  }, [target]);
  return Math.max(0, left);
}

// --- Toasts ------------------------------------------------------------------------------------

type ToastTone = "info" | "success" | "error";
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto max-w-md animate-rise rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-lift",
              t.tone === "error" && "bg-accent text-white",
              t.tone === "success" && "bg-good text-canvas",
              t.tone === "info" && "border border-line-strong bg-surface-3 text-fg",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
