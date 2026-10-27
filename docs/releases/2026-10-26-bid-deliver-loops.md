# Bid and deliver loops (2026-10-26)

**Goal:** propose on listings automatically, and add a second, attached loop that does the client's work once a bid is won. Vet hard, so the agent only bids on work it can finish with next to no human oversight.

## Pipeline

```
discovery tick (5 min) → lead scoring + Sonnet drafts → fast lane (pings app builds)
        │
        ▼
studio-bid loop (Opus, hourly)
  queue → vet each brief in full → record vet → place bid (Freelancer API, shared caps)
        │                                          └ can't place yet → shortlist.json for hand-send
        ▼
fast-lane award tracking (5 min): award offered on a vetted bid → auto-accept → Won
        │
        ▼
studio-deliver loop (Opus, hourly)
  sync → inbox → intake/kickoff message → build in data/studio/work/<id>/ → independent reviewer
  writes QA.md → deliver files + note on Freelancer → request milestone release → revisions → paid
```

- **The vet** (`scripts/studio-vet.mjs`) is deterministic. A `bid` verdict must name one of six autonomous delivery classes: static-site, web-component, script, data, writing or browser-extension. It also needs autonomy ≥ 8/10, nothing only a human can do, 2–12 testable acceptance criteria, ≤ 16 hours, 1–7 days, $40–$750, and a cover letter with no off-platform contact. A vet older than 6 hours can no longer place a bid. Native app builds are vetted `ping_ian` and never auto-bid.
- **Placing** (`studio-bid.mjs place` → `placeVettedBid`) reuses the fast lane's lock, caps (2 a day, 6 a month), $1,500 ceiling, USD fixed-price rule, live budget check and error back-off. Bids go out only when `fast-lane.json` mode is `auto`.
- **Fast lane in auto mode** bids only on fresh passing vets, leaves unvetted non-app drafts to the loop, and still pings app builds.
- **Awards:** `autoAcceptAwards: true`, for vetted autonomous bids only. If accept fails, the fast lane pings instead. Won vetted work goes to `studio-deliver`; manual or app wins keep the Studio autopilot.
- **Delivery** (`scripts/studio-deliver.mjs`): store `data/studio/deliveries.json`, one workspace per job. Every client-facing action goes through the CLI:
  - messages are capped at 6 per day per client;
  - email, phone, social and payment handles are blocked;
  - `deliver` refuses unless `QA.md` says `VERDICT: PASS`, ticks every acceptance criterion, and is newer than every file being shipped.

## Not verified live

API shapes come from Freelancer's official Python SDK (`freelancer-sdk-python`): bids POST and PUT `?action=accept`, `messages/0.1/threads`, thread messages, `milestones` PUT `?action=request_release`, and `milestone_requests`. They are exercised against mocks only. The first real accept, message, attachment upload and release request will be the true test; the multipart field names for attachments are the least certain. Public project reads were verified live.

## Controls

- Off: `node scripts/studio-fast-lane.mjs mode ping`, or create `data/studio/FAST-LANE-PAUSED`.
- Award auto-accept off: set `config.autoAcceptAwards` to `false` in `data/studio/fast-lane.json`.
- Status: `node scripts/studio-bid.mjs status` and `node scripts/studio-deliver.mjs list`.

## Verification

- Fast-lane, bid and deliver tests pass, including vet rules, cap sharing, the QA gate and mocked milestone release.
- Read-only live runs of `studio-bid.mjs status` and `queue` against the public API.
- A live `studio-bid` run found that Node `fetch` ignores an HTTP proxy set in the environment, so every live check failed inside a sandbox. Both CLIs now re-exec with `NODE_USE_ENV_PROXY=1` when a proxy is set; the next run confirmed live checks work.
