# Pehle design

Pehle is the link a seller or creator pins during a YouTube or Instagram live so a crowd can grab
limited stock fairly: the server decides who was first, holds the item for a timed payment, and
hands it to the next person automatically. Three stages: Drop, Pay, Come back.

## Direction

Facebook Marketplace's structure in dark mode (studied Nov 15 2026 in a signed-in browser),
with Pehle's own accent. The live room keeps the stream-first Twitch and Whatnot layout.

### Measured from Marketplace (dark)
- Neutrals: wash #1C1C1D, cards and nav #252728, raised #333334, hover overlay rgba(255,255,255,.1),
  hairline inner border rgba(255,255,255,.05), divider #65686C at low opacity.
- Text #E2E5E9 primary, #B0B3B8 secondary. Positive #3FBB46, negative #FF7C74, link #5AA7FF.
- Geometry: 56px top bar; 360px left sidebar; card radius 12px; button radius 8px, 36px tall;
  search inputs are 36-40px pills; sidebar rows 52px with 36px round icon bubbles.
- Browse grid: square photos (266px wide at 1512px, 8px gaps, four columns), then **price first in
  bold 17px**, title 15px one line, location 13px secondary. No card chrome around the tile.
- Item page: media viewer on the left with a blurred backdrop and a thumbnail strip, 500px info panel
  on the right: title 24px bold, price, "Listed 4 weeks ago in Delhi", a row of actions (primary
  message button, save, share, more), Details, description with "See more", location, then
  "Send seller a message" with a prefilled "Hi, is this available?".
- Selling: left sidebar with a primary "Create new listing", then Seller dashboard, Your listings,
  Announcements, Insights, Profile. Empty states are one line plus the create button.
- Create listing: form in the left column with a progress bar and Next button; a live preview of the
  listing on the right, updating as you type.

### Pehle tokens (apps/web/src/styles.css)
- `canvas` #1c1c1d, `surface` #252728, `surface-2` #2e3032, `surface-3` #3a3b3d, `line` #333436,
  `line-strong` #4b4d50, `fg` #e2e5e9, `fg-2` #b0b3b8, `muted` #8a8d91.
- `accent` #ff2d78 (rani pink) is the one action that matters: Claim, Sign in, Sell, primary buttons.
  Use `accent-soft` with accent text for Marketplace's soft-blue buttons ("Sell on Pehle").
- `gold` #ffc233 marks the waitlist and item codes in the room. `good` #3fbb46 means "it's yours"
  and paid. `live` #ff3b30 is the LIVE badge only.
- Fonts: Inter (with Mukta for Indic scripts) for UI; Bricolage Grotesque (`font-display`) for page
  titles, big numbers and the wordmark.
- Body 15px. Utilities: `.tile` (photo tile with hairline border), `.no-scrollbar`, `.tabular`.

### Shared components
- `components/shell.tsx`: `AppShell` (top bar, optional 360px sidebar at xl, phone bottom tabs),
  `BrowseSidebar`, `SideRow`, `PhotoTile`, `Wordmark`, `CATEGORIES`, `categoryLabel`.
- `components/sign-in.tsx`: `useSignIn()` opens the one sign-in sheet (Google, phone via Firebase,
  local dev form, link to the demo). Never build another sign-in form.
- `components/ui.tsx`: Button (8px corners), Card, Field, Input, Textarea, Badge, CodeChip, Avatar,
  Sheet, Empty, Spinner, toasts, `useCountdown`.
- `components/chat-feed.tsx`: Twitch-style chat lines and claim receipts for the room.

## Copy rules
- Sentence case everywhere. No decorative all-caps headings (small uppercase labels on badges are fine).
- Never use em dashes, en dashes or middle dots as separators in visible text. Write "Meera Sarees,
  Noida" or two lines, not "Meera Sarees · Noida".
- Say exactly what happens: "First to claim gets 10 minutes to pay", "It went to the next person in
  line". Prices in Indian format (₹4,500; ₹1,25,000), from `rupees()` in `lib/format.ts`.
- Free items read "Free" and "First to claim wins it".

## Responsive
- Phones first (390px). Bottom tabs on phones, top-bar tabs from md, sidebar from xl (1280px).
- Grids: 2 columns on phones, 3 at md, 4 at lg+, 5 at 2xl. 8px gaps on phones, 12px above.
- Nothing may overflow horizontally at 320px.
