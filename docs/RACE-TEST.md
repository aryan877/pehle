# Race test on the live site

200 buyers claimed the same drop at the same moment, on 2026-11-22 at 13:10 UTC, against the live site (https://pehle.aryankumar.dev). The drop had 10 pieces.

| Check | Result |
|---|---|
| Exactly 10 buyers got a hold | Yes (10 held) |
| Every place in line is unique, from 1 to 200, with no gaps | Yes |
| The 10 holds are places 1 to 10 | Yes |
| Failed claims | 0 |
| Waiting in line | 190 |
| Time for all 200 claims | 4.8 s from one laptop in Noida (median reply 1728 ms) |

Every claim and its place is public in the drop's fairness log: https://pehle.aryankumar.dev/fair/09b03ee7

How it was run: `bun scripts/race-test.ts 200 10`. It opens a practice shop, starts a drop with one 10-piece item, signs in 200 practice buyers and sends all 200 claims at once. Practice shops are excluded from `/stats`, and these buyers never connect to chat, so none of them count as users.

The race test sends claims through the Claim button path. It runs the same Postgres function as claims typed in chat. For claims typed in chat and ranked before delivery, see https://pehle.aryankumar.dev/fair/32b59aba (source "chat", decided 272 ms and 35 ms after Nexconn received each message).
