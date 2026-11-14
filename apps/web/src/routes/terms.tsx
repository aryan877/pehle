import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "~/components/legal";
import { AppShell } from "~/components/shell";

export const Route = createFileRoute("/terms")({ component: TermsPage });

function TermsPage() {
  return (
    <AppShell>
      <LegalPage title="Terms" updated="16 November 2026">
        <h2>What Pehle does</h2>
        <p>
          Pehle records who claimed an item first during a seller's drop, holds it for that buyer for a set time, and passes it to the next person
          in line if the buyer doesn't pay. The sale itself is between the buyer and the shop.
        </p>

        <h2>Buyers</h2>
        <ul>
          <li>A claim is a promise to pay within the hold time. If you don't, the item moves to the next person.</li>
          <li>Shops may limit how many items one person can hold at once.</li>
          <li>Questions about delivery, returns or refunds go to the shop. Each shop lists its own policies on its page.</li>
        </ul>

        <h2>Sellers</h2>
        <ul>
          <li>You are responsible for your listings, prices, delivery and any taxes, and for honouring the order Pehle records.</li>
          <li>Payments go to your own UPI ID or Razorpay account. Pehle does not take a cut or hold funds.</li>
          <li>Don't list anything illegal, counterfeit or unsafe. We may remove shops that do.</li>
        </ul>

        <h2>Everyone</h2>
        <ul>
          <li>Don't use bots or scripts to claim, and don't harass people in chat. We may block accounts that do.</li>
          <li>Pehle is provided as it is, while it is being built. We work to keep it running, but we can't promise it never goes down.</li>
        </ul>
      </LegalPage>
    </AppShell>
  );
}
