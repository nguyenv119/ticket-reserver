/**
 * Integration tests for POST /api/jobs/[id]/heartbeat — handler + real DB.
 *
 * Exercises the real route handler against a live Neon connection so that the
 * DB-touching code paths (200 happy path, 404, agent_note preserve semantics)
 * are covered by actual SQL round-trips, not mocks.
 *
 * Runs with: ./node_modules/.bin/tsx --test __tests__/heartbeat-integration.test.mts
 *
 * Prerequisites: DATABASE_URL must be set (loaded from .env.local at test init).
 * If unreachable the suite is skipped with a clear message rather than failing.
 *
 * Test strategy: real DB > in-memory > mock (per quality.md mock-discipline).
 * The handler is imported directly and invoked with a NextRequest — same call
 * path as production, minus the Next.js HTTP layer.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Load .env.local before any DB modules are imported ───────────────────────
const dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(dir, "..", ".env.local");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local missing — DATABASE_URL may already be in the environment
}

// ── Skip suite when DATABASE_URL is absent ───────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping live-DB integration tests";

// Lazy-loaded after env is ready
let POST: (
  req: import("next/server").NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;
let sql: import("@neondatabase/serverless").NeonQueryFunction<false, false>;
let ensureSchema: () => Promise<void>;
let NextRequest: typeof import("next/server").NextRequest;

const TEST_JOB_ID = "test-heartbeat-integration-" + Date.now();

before(async () => {
  if (SKIP_REASON) return;

  // Import DB utilities and ensure the schema is ready
  const dbMod = await import("../lib/db.js");
  sql = dbMod.sql as unknown as import("@neondatabase/serverless").NeonQueryFunction<
    false,
    false
  >;
  ensureSchema = dbMod.ensureSchema;
  await ensureSchema();

  // Insert a throwaway job row
  await sql`
    insert into jobs (id, venue_url, seats, status, source)
    values (
      ${TEST_JOB_ID},
      'https://test-integration.example/venue',
      '2',
      'holding',
      'mock'
    )
  `;

  // Import NextRequest (ESM — no require() available in .mts files)
  const nextServer = await import("next/server.js");
  NextRequest = nextServer.NextRequest;

  // Import the real handler after schema exists
  const routeMod = await import(
    "../app/api/jobs/[id]/heartbeat/route.js"
  );
  POST = routeMod.POST;
});

after(async () => {
  if (SKIP_REASON || !sql) return;
  // Clean up the test row so repeated runs don't accumulate rows
  try {
    await sql`delete from jobs where id = ${TEST_JOB_ID}`;
  } catch {
    // Best-effort: don't fail the suite on cleanup error
  }
});

/** Build a NextRequest for the heartbeat endpoint. */
function makeRequest(body: unknown): import("next/server").NextRequest {
  return new NextRequest(`http://localhost/api/jobs/${TEST_JOB_ID}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build the route context (params is a Promise per Next.js 15+ convention). */
function makeCtx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/jobs/[id]/heartbeat — live DB", { skip: SKIP_REASON ?? false }, () => {
  it("200: updates hold_state and last_heartbeat_at, does NOT touch status or source", async () => {
    /**
     * Core happy path. The heartbeat must update agent-owned columns
     * (hold_state, last_heartbeat_at) and leave user-intent columns
     * (status, source) unchanged — column-semantics invariant from lib/types.ts.
     */
    // GIVEN — a job exists with status='holding', source='mock'
    const req = makeRequest({ hold_state: "confirmed", agent_note: "seats locked" });
    const ctx = makeCtx(TEST_JOB_ID);

    // WHEN
    const res = await POST(req, ctx);

    // THEN
    assert.equal(res.status, 200, "expected 200 for existing job");
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.hold_state, "confirmed", "hold_state must be updated");
    assert.ok(body.last_heartbeat_at, "last_heartbeat_at must be set");
    assert.equal(body.status, "holding", "status must NOT be changed by heartbeat");
    assert.equal(body.source, "mock", "source must NOT be changed by heartbeat");
    assert.equal(body.agent_note, "seats locked", "agent_note must be stored");
  });

  it("200 (bare ping): agent_note is preserved when key is absent from body", async () => {
    /**
     * PATCH-style preserve semantics from Finding 1.
     * A bare status ping that omits agent_note must leave the previously stored
     * note intact. Agents frequently send {hold_state:"confirmed"} heartbeats
     * between substantive updates; erasing the note on each ping loses context
     * that the UI relies on.
     */
    // GIVEN — previous test stored agent_note="seats locked"; now send bare ping
    const req = makeRequest({ hold_state: "confirmed" });
    const ctx = makeCtx(TEST_JOB_ID);

    // WHEN
    const res = await POST(req, ctx);

    // THEN
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(
      body.agent_note,
      "seats locked",
      "agent_note must be preserved when key is absent from heartbeat body",
    );
  });

  it("200: agent_note is overwritten when key is explicitly present", async () => {
    /**
     * The other side of the preserve semantics: when agent_note IS present in
     * the body (even as empty string), it must overwrite the stored value.
     * Otherwise the agent cannot update or clear a note.
     */
    // GIVEN — previous note was "seats locked"; agent sends new note
    const req = makeRequest({ hold_state: "confirmed", agent_note: "updated note" });
    const ctx = makeCtx(TEST_JOB_ID);

    // WHEN
    const res = await POST(req, ctx);

    // THEN
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.agent_note, "updated note", "agent_note must be overwritten when present");
  });

  it("200: agent_note can be cleared by sending empty string", async () => {
    /**
     * Agents must be able to clear a previously stored note by sending "".
     * If empty string were treated the same as omitted (COALESCE approach),
     * clearing would be impossible and old notes would be stuck forever.
     */
    // GIVEN — previous note was "updated note"
    const req = makeRequest({ hold_state: "holding", agent_note: "" });
    const ctx = makeCtx(TEST_JOB_ID);

    // WHEN
    const res = await POST(req, ctx);

    // THEN
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.agent_note, "", "agent_note must be set to empty string when explicitly sent");
  });

  it("404: returns error for a non-existent job id", async () => {
    /**
     * A heartbeat for an unknown job id must return 404, not 200 or 500.
     * Agents routinely retry heartbeats; returning 200 for a ghost row would
     * silently swallow protocol errors and make debugging extremely difficult.
     */
    // GIVEN — an id that definitely does not exist
    const req = makeRequest({ hold_state: "holding" });
    const ctx = makeCtx("non-existent-job-id-that-does-not-exist");

    // WHEN
    const res = await POST(req, ctx);

    // THEN
    assert.equal(res.status, 404, "expected 404 for missing job");
    const body = await res.json() as Record<string, unknown>;
    assert.ok(
      typeof body.error === "string" && body.error.length > 0,
      "response body must contain a non-empty error string",
    );
  });
});
