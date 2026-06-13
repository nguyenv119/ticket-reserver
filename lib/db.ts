import { neon } from "@neondatabase/serverless";

// Single shared Neon HTTP client. Works in Next route handlers AND the worker
// (both just need process.env.DATABASE_URL).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set (see .env.local)");

export const sql = neon(url);

// Demo timing knobs. Real venues give ~15min; we compress so the loop is
// visible. Worker re-holds well before this expires.
export const VENUE_HOLD_TTL_SECONDS = Number(
  process.env.VENUE_HOLD_TTL_SECONDS ?? 30,
);
export const WORKER_REFRESH_SECONDS = Number(
  process.env.WORKER_REFRESH_SECONDS ?? 6,
);

let schemaReady: Promise<void> | null = null;

// Lazily create tables on first DB touch. Cheap (IF NOT EXISTS) and keeps the
// demo zero-setup — no migration step.
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        create table if not exists jobs (
          id text primary key,
          venue_url text not null,
          seats text not null,
          status text not null default 'holding',
          message text,
          freed boolean not null default false,
          last_held_at timestamptz,
          hold_expires_at timestamptz,
          created_at timestamptz not null default now()
        )`;
      await sql`
        create table if not exists venue_seats (
          seat text primary key,
          status text not null default 'available',
          holder text,
          hold_expires_at timestamptz
        )`;
    })();
  }
  return schemaReady;
}
