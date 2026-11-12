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

### Pehle tokens

Accent, neutrals and type scale to follow once the Marketplace measurements settle. The live room
keeps a Twitch/Whatnot-style stream layout.
