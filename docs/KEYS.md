# Keys and settings to go live

Everything is coded. Each item below is a key to paste into `.env` (local) or
`infra/.env.production` (server), plus the exact console settings. Values marked "we generate"
need no account.

## 1. Nexconn (required, do first)
1. Console: create the app (or use the existing one) and **enrol it in Chat Growth Credit**. The
   default Free plan expires one month after creation and blocks the app, which would land during
   judging (Nov 23 to 27). Only one app per organisation can be enrolled and it cannot be changed, so
   enrol the App Key you will submit. It unlocks after the first message is sent.
2. Copy `NEXCONN_APP_KEY` and `NEXCONN_APP_SECRET`. Data centre: Singapore (`https://api.sg-light-api.com`).
3. Chat settings, Webhooks: one URL, `https://<domain>/webhooks/nexconn`. Turn on
   `open_channel:pre_messaging`, `message:send`, `open_channel:metadata_update`,
   `open_channel:operation` and `user:connection_status`, and turn on
   **Include Server API Messaging in post-event webhooks**.
4. Chat settings, Open Channels: turn on **Restrict messaging to joined participants** and
   **Allow participation in multiple channels** (a visitor sits in the home feed and a drop room at once).
   Make sure open channel metadata (KV) is enabled.
5. Chat settings, Group Channels: turn on **Enable pre-join history access by new member**; turn off
   **Group management via chat SDK** (only our server changes membership).
6. Chat settings, Messages, Translation: turn on (optional; Hindi and regional languages).
7. Security: add the production domain to **Domain allowlist for Web client**.
8. Settings take about 15 minutes to apply.
9. Capacity: 500 concurrent connections and 10,000 monthly users on Growth Credit. Above 500 at once,
   new connections error unless a card is bound. The room keeps working through the API when chat
   cannot connect, but bind a card before any drop expected to exceed 500 people at the same time.

## 2. Server and domain (required)
- A Linux server with Docker (2 vCPU, 4 GB is plenty) and a domain pointing at it (A record).
- `infra/.env.production`: `PEHLE_DOMAIN`, `PEHLE_PUBLIC_URL=https://<domain>`, Postgres password.
- `docker compose -f infra/compose.yml up -d`. Caddy gets the TLS certificate.

## 3. Google sign-in (recommended)
Google Cloud console, APIs and Services, Credentials, OAuth client ID (Web application):
- Authorised redirect URIs: `https://<domain>/api/v1/auth/google/callback` and
  `http://localhost:5173/api/v1/auth/google/callback`.
- OAuth consent screen: External, with home page, `/privacy` and `/terms` links (publishing requires them), then
  publish it. Only basic scopes are used and there is no logo, so no review is needed.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## 4. Phone sign-in with Firebase (recommended for Indian buyers and sellers)
Firebase console: create a project (or add Firebase to the Google Cloud project above).
- Authentication, Sign-in method: enable **Phone**.
- Authentication, Settings, Authorised domains: add the production domain (localhost is there already).
- Authentication, Sign-in method, Phone, **Phone numbers for testing**: add `+91 99999 00001` with code
  `123456` for judges and demos (no SMS is sent for test numbers).
- Authentication, Settings, SMS region policy: Allow, India. Without it every SMS fails with
  `auth/operation-not-allowed`.
- Without billing a new project can send 10 real SMS a day; test numbers don't count. More needs the Blaze
  (pay as you go) plan; check the current SMS price for India first.
- Project settings, General, Web app config: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`
  (and `FIREBASE_AUTH_DOMAIN` if it is not `<project>.firebaseapp.com`).

## 5. Payments (each seller connects their own account)
Sellers connect Razorpay in Studio, Settings, Payments: Key ID and Key Secret from Razorpay
Dashboard, Account and Settings, API Keys (test keys first), and the webhook secret shown there.
In Razorpay, add the webhook `https://<domain>/webhooks/razorpay/<shop id>` with the event
`payment_link.paid`. Money settles straight to the seller. Shops without Razorpay use UPI with a
reported reference that the seller confirms.
- `PEHLE_SECRET_KEY` (we generate): encrypts sellers' gateway secrets. `openssl rand -base64 32`.

## 6. YouTube chat claims (optional)
Google Cloud console: enable **YouTube Data API v3**, create an API key restricted to that API.
`YOUTUBE_API_KEY`. Viewers can then type "mine" in the seller's YouTube live chat.

## 7. AI co-host (optional)
Any OpenAI-compatible endpoint. Defaults to OpenRouter: `COHOST_API_KEY`, optional `COHOST_MODEL`
(default `google/gemini-2.5-flash`) and `COHOST_API_URL`.

## 8. Browser notifications (we generate)
`pehle-api vapid-keys` prints `PEHLE_VAPID_PRIVATE_KEY`. Set `PEHLE_VAPID_SUBJECT` to
`mailto:<a real address>` or the site URL. No push service account is needed.

## 9. Demo shop
On by default (`PEHLE_DEMO=true`): `/try` lets anyone race four scripted rivals. Rivals never connect
to chat, so they never count as users.
