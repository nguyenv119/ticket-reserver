# 🪄 Seat Holder

Paste a ticket-page URL + the seats you found, hit **Submit**, and a worker
keeps those seats reserved forever — re-holding before each 15-min timer
expires — until you press **Release**. The party trick: release from your phone
and the seats free instantly, like magic.

This repo is a **working demo against a mock venue**. The seat-holding action is
one pluggable function; swap it for a real site (see below).

## Run it

Two processes — web + always-on worker:

```bash
npm run go      # runs `next dev` + worker together
# or separately:
npm run dev     # web only
npm run worker  # the holding loop only
```

Open:

- **Control app** — http://localhost:3000 (the "magic" UI)
- **Mock ticket page** — http://localhost:3000/venue (watch seats live)

> If port 3000 is busy, Next picks 3001 — check the terminal. Use that URL as
> the "Ticket page URL" you paste in.

### Demo flow

1. Open `/venue`, note free seats (e.g. **C4, C5**).
2. In the control app, paste the `/venue` URL + `C4, C5`, hit **Submit**.
3. Watch `/venue`: C4/C5 go red and their countdown keeps **resetting** — the
   worker re-holds before each expiry.
4. Hit **Release**. Seats free on the next worker tick. 🪄

Timing is compressed for the demo via `.env.local`:

- `VENUE_HOLD_TTL_SECONDS=30` — a "hold" lasts 30s (real sites ≈ 15 min).
- `WORKER_REFRESH_SECONDS=6` — worker re-holds every 6s.

## Architecture

| Piece | File | Role |
|---|---|---|
| Control UI | `app/page.tsx` | Submit / Release / live status |
| Mock venue | `app/venue/page.tsx` + `app/api/venue/*` | Stand-in ticketing site with self-expiring holds |
| Jobs API | `app/api/jobs/*` | Create / list / release holding jobs |
| Worker | `worker/index.ts` | Always-on loop: re-hold active jobs, free released ones |
| Hold engine | `lib/holdEngine.ts` | **The one pluggable piece** |
| DB | `lib/db.ts` (Neon Postgres) | Shared state between web + worker |

## Making it work on a REAL site

Today `lib/holdEngine.ts` re-holds rows in our own `venue_seats` table. To hold
seats on an actual ticketing site, replace `hold()` / `release()` with a
**headless browser driven by Claude** (Playwright + Claude Agent SDK / Computer
Use). Same signatures, same worker — only the body changes:

```ts
export async function hold(job: HoldJob) {
  // launch headless browser, go to job.venue_url, log in,
  // find job.seats, click "hold/reserve". This is the per-site part.
}
```

Reality check, per site:

- **Login + session cookies + CSRF tokens** are almost always required.
- **Bot protection** (Cloudflare, captcha, Ticketmaster Queue-it) may block
  scripted holds outright — small/indie venues are the realistic targets.
- **Hosting**: the worker must run somewhere always-on (Railway / Render / a Mac
  left on). Vercel serverless can't hold a 15-min loop. `Claude-in-Chrome` is
  interactive-only and can't be the autonomous engine — but it's perfect for
  *exploring* a venue's hold flow to learn what to script.

> ⚠️ Holding seats indefinitely may violate a venue's terms and ties up seats
> others want. Use on seats you actually intend to buy.

## Deploy (web only)

The Next app deploys to Vercel as-is (set `DATABASE_URL`). The **worker** does
not — it needs a persistent host. Point both at the same Neon database.
