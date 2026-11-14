import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "~/components/legal";
import { AppShell } from "~/components/shell";

export const Route = createFileRoute("/privacy")({ component: PrivacyPage });

function PrivacyPage() {
  return (
    <AppShell>
      <LegalPage title="Privacy policy" updated="16 November 2026">
        <p>Pehle lets sellers and creators run fair drops during a live stream. This page says what we store, why, and who else sees it.</p>

        <h2>What we store</h2>
        <ul>
          <li>Your name, and the email address or phone number you sign in with. Google or Firebase confirms them; we never see a password.</li>
          <li>Your claims, holds, orders and the time each one was decided, because that order is the whole point of a fair drop.</li>
          <li>Chat messages you send in drop rooms and shop conversations.</li>
          <li>If you win a paid item: the phone number, delivery address and payment reference you enter at checkout.</li>
          <li>If you turn on notifications: your browser's push subscription, so we can tell you when a drop starts or a hold moves to you.</li>
        </ul>

        <h2>Who sees it</h2>
        <ul>
          <li>Other people in a drop room see only your first name and initial next to your claim.</li>
          <li>
            The shop you buy from sees your name, delivery details and payment reference for its own orders, and nothing about your orders with
            other shops.
          </li>
          <li>
            Chat is carried by Nexconn. Sign-in is handled by Google and Firebase. Payments go directly to the seller through UPI or the seller's
            own Razorpay account; Pehle never holds your money or card details.
          </li>
        </ul>
        <p>We do not sell your data, show ads, or use third-party tracking.</p>

        <h2>How long we keep it</h2>
        <p>
          Orders and the claim record stay as long as the shop exists, so a buyer or seller can check what happened. Sign-in sessions expire on
          their own. Email us to delete your account; we remove your personal details and keep only anonymous claim times so past drops stay
          verifiable.
        </p>
      </LegalPage>
    </AppShell>
  );
}
