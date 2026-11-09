import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Phone, Sparkles } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { api, keys, unwrap, type SessionInfo } from "~/lib/api";
import { resetChat } from "~/lib/chat";
import { useSession } from "~/lib/session";

import { LegalNote } from "./legal";
import { Button, Field, Input, Sheet, errorMessage } from "./ui";

/** Who is signing in: a buyer (rooms, claims, inbox) or a shop team member (the studio). */
export type SignInRole = "buyer" | "staff";

interface SignInRequest {
  role?: SignInRole;
  /** Where to land after Google's redirect. Phone and dev sign-in stay on the page. */
  next?: string;
  title?: string;
  reason?: ReactNode;
}

const SignInContext = createContext<(request?: SignInRequest) => void>(() => undefined);

/** Open the sign-in sheet from anywhere: `const signIn = useSignIn(); signIn({ reason: "..." })`. */
export function useSignIn() {
  return useContext(SignInContext);
}

export function SignInProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<SignInRequest | null>(null);
  const open = useCallback((r: SignInRequest = {}) => setRequest(r), []);
  return (
    <SignInContext.Provider value={open}>
      {children}
      {request ? <SignInSheet request={request} onClose={() => setRequest(null)} /> : null}
    </SignInContext.Provider>
  );
}

function SignInSheet({ request, onClose }: { request: SignInRequest; onClose: () => void }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const role = request.role ?? "buyer";
  const next = request.next ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
  const [mode, setMode] = useState<"choose" | "phone">("choose");
  const info = session.data;

  const signedIn = async (fresh: SessionInfo) => {
    await resetChat();
    queryClient.setQueryData(keys.session, fresh);
    await queryClient.invalidateQueries();
    onClose();
  };

  const title = request.title ?? (role === "staff" ? "Sign in to your shop" : "Sign in to claim");
  return (
    <Sheet open onClose={onClose} title={title}>
      {mode === "phone" && info?.phoneSignIn ? (
        <PhoneSignIn config={info.phoneSignIn} role={role} onBack={() => setMode("choose")} onSignedIn={signedIn} />
      ) : (
        <div className="space-y-3">
          <p className="text-fg-2">
            {request.reason ??
              (role === "staff"
                ? "Run drops, see who claimed first and get paid on your own UPI or Razorpay account."
                : "So the shop knows a real person claimed. The room shows only your first name and initial. Your address is asked only if you win, and only the shop sees it.")}
          </p>
          {info?.googleSignIn ? (
            <a
              href={`/api/v1/auth/google/start?as=${role}&next=${encodeURIComponent(next)}`}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-white text-[15px] font-semibold text-[#1f1f1f] transition hover:bg-white/90"
            >
              <GoogleMark /> Continue with Google
            </a>
          ) : null}
          {info?.phoneSignIn ? (
            <Button variant="secondary" size="lg" block onClick={() => setMode("phone")}>
              <Phone className="size-4" /> Continue with phone number
            </Button>
          ) : null}
          {info?.devSignIn ? <DevSignIn role={role} onSignedIn={signedIn} /> : null}
          {!info?.googleSignIn && !info?.phoneSignIn && !info?.devSignIn ? (
            <p className="text-[13px] text-muted">Sign-in is being set up. Try again in a moment.</p>
          ) : null}
          {info?.googleSignIn || info?.phoneSignIn ? <LegalNote onNavigate={onClose} /> : null}
          {role === "buyer" && info?.demo ? (
            <Link
              to="/try"
              onClick={onClose}
              className="flex items-center justify-center gap-1.5 pt-1 text-[14px] font-semibold text-fg-2 hover:text-fg"
            >
              <Sparkles className="size-4 text-gold" /> Just looking? Try a demo drop without signing in
            </Link>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

type Confirm = (code: string) => Promise<string>;

/**
 * Phone sign-in through Firebase Authentication: Firebase sends the SMS and checks the code, then
 * our server verifies Firebase's ID token and starts its own session. Firebase is loaded only here.
 */
function PhoneSignIn({
  config,
  role,
  onBack,
  onSignedIn,
}: {
  config: NonNullable<SessionInfo["phoneSignIn"]>;
  role: SignInRole;
  onBack: () => void;
  onSignedIn: (session: SessionInfo) => Promise<void>;
}) {
  const [digits, setDigits] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recaptcha = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const send = useMutation({
    mutationFn: async () => {
      const { initializeApp, getApps } = await import("firebase/app");
      const { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut } = await import("firebase/auth");
      const app = getApps().find((a) => a.name === "pehle") ?? initializeApp(config, "pehle");
      const auth = getAuth(app);
      auth.useDeviceLanguage();
      cleanup.current?.();
      // reCAPTCHA refuses to render twice into one element, so every attempt gets a fresh one.
      const host = document.createElement("div");
      recaptcha.current!.replaceChildren(host);
      const verifier = new RecaptchaVerifier(auth, host, { size: "invisible" });
      cleanup.current = () => {
        verifier.clear();
        host.remove();
      };
      const result = await signInWithPhoneNumber(auth, `+91${digits}`, verifier);
      return (async (entered: string) => {
        const credential = await result.confirm(entered);
        const token = await credential.user.getIdToken();
        // Our own session takes over; Firebase is only the SMS check.
        await signOut(auth);
        return token;
      }) satisfies Confirm;
    },
    onSuccess: (fn) => {
      setError(null);
      setConfirm(() => fn);
    },
    onError: (e) => setError(firebaseMessage(e)),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const idToken = await confirm!(code);
      return unwrap(api.POST("/api/v1/auth/phone", { body: { idToken, as: role, displayName: name.trim() || null } }));
    },
    onSuccess: onSignedIn,
    onError: (e) => setError(firebaseMessage(e)),
  });

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="-mt-1 inline-flex items-center gap-1 text-[14px] font-semibold text-fg-2 hover:text-fg">
        <ArrowLeft className="size-4" /> Other ways to sign in
      </button>
      {!confirm ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <Field label="Mobile number" htmlFor="phone" error={error} hint="We send a 6-digit code by SMS.">
            <div className="flex">
              <span className="inline-flex h-12 items-center rounded-l-md border border-r-0 border-line-strong bg-surface-2 px-3 text-[15px] text-fg-2">
                +91
              </span>
              <Input
                id="phone"
                inputMode="numeric"
                autoComplete="tel-national"
                className="rounded-l-none"
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="98100 00000"
                required
              />
            </div>
          </Field>
          <Field label="Your name" htmlFor="phone-name" hint="Shown as first name and initial, for example Priya S.">
            <Input id="phone-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Optional" />
          </Field>
          <Button type="submit" size="lg" block loading={send.isPending} disabled={digits.length !== 10}>
            Send code
          </Button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate();
          }}
        >
          <Field label={`Code sent to +91 ${digits}`} htmlFor="otp" error={error}>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              className="text-center text-xl tracking-[0.4em]"
              autoFocus
              required
            />
          </Field>
          <Button type="submit" size="lg" block loading={verify.isPending} disabled={code.length !== 6}>
            Verify and continue
          </Button>
          <button
            type="button"
            className="w-full text-center text-[14px] font-semibold text-fg-2 hover:text-fg"
            onClick={() => {
              setConfirm(null);
              setCode("");
            }}
          >
            Change number or resend
          </button>
        </form>
      )}
      <div ref={recaptcha} />
    </div>
  );
}

function firebaseMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code.includes("invalid-verification-code")) return "That code is not right. Check the SMS and try again.";
  if (code.includes("code-expired")) return "That code expired. Send a new one.";
  if (code.includes("too-many-requests")) return "Too many tries from this device. Wait a few minutes.";
  if (code.includes("invalid-phone-number")) return "Enter a 10-digit Indian mobile number.";
  if (code.includes("quota-exceeded")) return "SMS sign-in is busy right now. Use Google or try later.";
  return errorMessage(error);
}

function DevSignIn({ role, onSignedIn }: { role: SignInRole; onSignedIn: (session: SessionInfo) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const join = useMutation({
    mutationFn: () =>
      role === "staff"
        ? unwrap(api.POST("/api/v1/auth/dev", { body: { email, displayName: name } }))
        : unwrap(api.POST("/api/v1/session/buyer", { body: { displayName: name, preferredLanguage: "en" } })),
    onSuccess: onSignedIn,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form
      className="space-y-3 rounded-xl border border-dashed border-line-strong p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        join.mutate();
      }}
    >
      <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Local testing only</p>
      {role === "staff" ? (
        <Field label="Email" htmlFor="dev-email">
          <Input id="dev-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="meera@demo.pehle" required />
        </Field>
      ) : null}
      <Field label="Name" htmlFor="dev-name" error={error}>
        <Input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya S." maxLength={40} required />
      </Field>
      <Button type="submit" variant="secondary" block loading={join.isPending} disabled={!name.trim()}>
        Continue without Google
      </Button>
    </form>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
