# Lead engine (2026-10-13)

## Before

Discovery worked (about 1,000 cached Freelancer listings on a 5-minute cadence), but the `suitable` keyword flag matched 904 of 1,000 listings, so nothing was ranked. No listing had been shortlisted and no job imported in two weeks. Discovery dropped bid counts, so competition was invisible. There were only 4 search terms and no proposal drafting; every step after discovery was manual.

## Shipped

- `scripts/studio-leads.mjs` scores every listing deterministically (0–100). The score combines USD-converted budget, fast-deliverable fit, out-of-scope disqualifiers (design, video, regulated or physical work), red flags (off-platform contact, upfront fees, academic work), bid count, freshness, language and brief quality. A lead is "hot" only on a strong deliverable match. The suggested bid is 90% of the average bid, kept inside the client's range.
- Automatic drafting. Each discovery tick drafts up to 3 proposals (30 a day) through local Claude Sonnet with no tools and a strict JSON schema. The drafter declines unfit work itself and must not invent clients, metrics or reviews.
- Funnel: drafted → sent → won/lost, with dismiss, reopen and expiry after 7 days. Marking a lead Won creates a Studio job with price and deadline set. Autopilot then analyzes it with Opus; on a clean `accept` (no questions, missing inputs or rights flags) it approves the plan and starts zero-spend production. Anything else stops for review. Final delivery is never automatic.
- Discovery now runs targeted searches, keeps bid count, average bid, urgency and language, and runs the lead pipeline every tick. A `STOP` file or `data/studio/LEADS-PAUSED` pauses drafting only.
- UI: Studio opens on **Hot leads** (funnel metrics, score, budget, bids, age, proposal, "Copy proposal & open listing", Mark sent/Won/Lost, Redraft, Dismiss).

## Verification

- Lead and discovery unit tests pass.
- Live drafts on real listings, including correct declines of tax-return preparation and PCB soldering work.
- Read-only browser QA (`web/qa/studio-leads-qa.mjs`) at 1440 px and 390 px: no horizontal overflow, no page errors. Unauthenticated API calls return 401 and cross-origin POSTs return 403.
