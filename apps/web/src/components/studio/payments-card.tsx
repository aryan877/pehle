import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, Field, Input, Spinner, errorMessage, useToast } from "~/components/ui";
import { api, unwrap } from "~/lib/api";

import { CopyButton } from "./bits";

/**
 * Connect the shop's own Razorpay account. Payments then settle straight to the shop and are
 * confirmed automatically; Pehle never holds the money.
 */
export function PaymentsCard({ shopId }: { shopId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["shop", shopId, "payments"] as const;
  const setup = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/payments", { params: { path: { shop_id: shopId } } })),
  });
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () =>
      unwrap(api.PUT("/api/v1/shops/{shop_id}/payments", { params: { path: { shop_id: shopId } }, body: { keyId, keySecret } })),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setKeySecret("");
      toast("Razorpay connected. Payments now confirm themselves.", "success");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const disconnect = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/shops/{shop_id}/payments", { params: { path: { shop_id: shopId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info">
          <CreditCard className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Automatic payments</h2>
          <p className="text-sm text-muted">
            Connect your own Razorpay account. Buyers pay by UPI, card or netbanking, the money goes straight to you, and orders
            confirm themselves. Without it, buyers pay your UPI ID and you confirm each payment by hand.
          </p>
        </div>
        {setup.data?.connected ? <Badge tone={setup.data.liveMode ? "held" : "wait"}>{setup.data.liveMode ? "Live" : "Test mode"}</Badge> : null}
      </div>

      {setup.isPending ? (
        <Spinner />
      ) : !setup.data?.available ? (
        <p className="rounded-xl bg-gold-soft p-3 text-sm text-gold">Automatic payments are not enabled on this server yet.</p>
      ) : setup.data.connected ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-good" /> Connected with key <b className="font-mono">{setup.data.keyId}</b>
          </p>
          <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
            <p className="text-sm font-semibold">Last step: tell Razorpay where to send payment updates</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-2">
              <li>
                In Razorpay, open <b>Account &amp; Settings</b> → <b>Webhooks</b> → <b>Add new webhook</b>.
              </li>
              <li>Paste this URL and secret, tick the events below, and save.</li>
            </ol>
            <SecretRow label="Webhook URL" value={setup.data.webhookUrl} />
            {setup.data.webhookSecret ? <SecretRow label="Secret" value={setup.data.webhookSecret} /> : null}
            <p className="text-[13px] text-muted">Events: {setup.data.webhookEvents.join(", ")}</p>
            <p className="text-[13px] text-muted">If you skip this, Pehle still checks each payment every few seconds.</p>
          </div>
          <Button variant="danger" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
            Disconnect Razorpay
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            connect.mutate();
          }}
        >
          <p className="text-sm text-fg-2">
            In Razorpay, open <b>Account &amp; Settings</b> → <b>API Keys</b> and generate a key. Test keys work straight away; live keys
            need Razorpay to activate your account.{" "}
            <a href="https://dashboard.razorpay.com/app/website-app-settings/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent">
              Open Razorpay <ExternalLink className="size-3.5" />
            </a>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Key ID" htmlFor="rzp-id">
              <Input id="rzp-id" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_…" autoComplete="off" spellCheck={false} required />
            </Field>
            <Field label="Key secret" htmlFor="rzp-secret" error={error}>
              <Input id="rzp-secret" type="password" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} autoComplete="off" required />
            </Field>
          </div>
          <p className="text-[13px] text-muted">Your key secret is checked with Razorpay, then stored encrypted. Only the server can read it.</p>
          <Button type="submit" loading={connect.isPending} disabled={!keyId.trim() || !keySecret.trim()}>
            Connect Razorpay
          </Button>
        </form>
      )}
    </Card>
  );
}

function SecretRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[13px] font-semibold text-fg-2">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-lg bg-canvas px-2.5 py-1.5 font-mono text-[12px]">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}
