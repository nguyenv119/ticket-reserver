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

      // ── Agent contract columns (added idempotently for existing DBs) ────────
      // hold_state  = AGENT-OBSERVED REALITY (holding|confirmed|lost|released)
      // source      = WRITER FENCE (agent|mock)
      await sql`alter table jobs add column if not exists hold_state text not null default 'holding'`;
      await sql`alter table jobs add column if not exists last_heartbeat_at timestamptz`;
      await sql`alter table jobs add column if not exists agent_note text`;
      await sql`alter table jobs add column if not exists source text not null default 'agent'`;

      // CHECK constraints cannot use IF NOT EXISTS — guard by checking
      // pg_constraint so re-running ensureSchema() is still idempotent.
      // UNTESTED: runtime path — no test framework is installed; this is
      // verified by manual smoke only. The ::regclass is schema-qualified to
      // avoid search_path ambiguity on Neon's stateless HTTP driver.
      const hsRows = await sql`
        select count(*)::text as count from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_hold_state_check'` as { count: string }[];
      if (hsRows[0].count === "0") {
        await sql`
          alter table jobs
          add constraint jobs_hold_state_check
          check (hold_state in ('holding','confirmed','lost','released'))`;
      }

      const srcRows = await sql`
        select count(*)::text as count from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_source_check'` as { count: string }[];
      if (srcRows[0].count === "0") {
        await sql`
          alter table jobs
          add constraint jobs_source_check
          check (source in ('agent','mock'))`;
      }
    })();
  }
  return schemaReady;
}
