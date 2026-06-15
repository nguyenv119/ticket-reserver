/**
 * Tests for the heartbeat endpoint — validation logic and handler contracts.
 *
 * Runs with: ./node_modules/.bin/tsx --test __tests__/heartbeat.test.mts
 *
 * Test strategy:
 *   - lib/heartbeat-validation.ts is a pure module (no DB import); tested
 *     directly with real imports.
 *   - The handler itself (app/api/jobs/[id]/heartbeat/route.ts) imports
 *     lib/db.ts which immediately calls neon(DATABASE_URL) at the module
 *     level. mock.module is not available in Node 23 + tsx; therefore the
 *     handler is not imported here.
 *     The DB-touching path is covered by the validation integration: if
 *     validateHeartbeatBody returns { ok: false }, the handler returns 400
 *     before touching the DB; if it returns { ok: true } and the UPDATE
 *     returns 0 rows, the handler returns 404. These contracts are verified
 *     through the pure-function tests plus the acceptance criteria in the
 *     bead (manual / integration verification).
 *
 * REVIEW: handler DB path not tested here — no in-memory Neon alternative
 * is wired in this project and mock.module is unavailable in Node 23.7.0
 * with tsx. An integration test against the real Neon DB would be the correct
 * complement and should be added when a test-DB env is available.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let validateHeartbeatBody: (raw: unknown) => { ok: true; body: unknown } | { ok: false; error: string };
let HOLD_STATES: readonly string[];

before(async () => {
  const mod = await import("../lib/heartbeat-validation.js");
  validateHeartbeatBody = mod.validateHeartbeatBody;
  HOLD_STATES = mod.HOLD_STATES;
});

describe("HOLD_STATES", () => {
  it("contains exactly the four values in the HoldState union type", () => {
    /**
     * The runtime list and the TypeScript union type must stay in sync.
     * If a new variant is added to HoldState but not to HOLD_STATES, the
     * validation will reject a value that TypeScript considers valid, causing
     * the agent to get 400 errors for a valid heartbeat.
     */
    // GIVEN — the set of values declared in lib/types.ts
    const expectedStates = new Set(["holding", "confirmed", "lost", "released"]);

    // WHEN — no action; checking the static list
    const actualStates = new Set(HOLD_STATES);

    // THEN
    assert.deepEqual(actualStates, expectedStates);
  });
});

describe("validateHeartbeatBody", () => {
  it("returns ok:true for a minimal valid body with hold_state only", () => {
    /**
     * agent_note is optional; a heartbeat with only hold_state must be accepted.
     * Rejecting it would break the minimal heartbeat contract and prevent the
     * agent from reporting its state without an attached note.
     */
    // GIVEN
    const raw = { hold_state: "holding" };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.body as { hold_state: string }).hold_state, "holding");
    }
  });

  it("returns ok:true for a body with hold_state and agent_note", () => {
    /**
     * The full valid heartbeat body includes both fields. Both must be
     * accepted and threaded through to the caller so the DB UPDATE can
     * set agent_note.
     */
    // GIVEN
    const raw = { hold_state: "confirmed", agent_note: "seats still locked" };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, true);
    if (result.ok) {
      const body = result.body as { hold_state: string; agent_note?: string };
      assert.equal(body.hold_state, "confirmed");
      assert.equal(body.agent_note, "seats still locked");
    }
  });

  it("returns ok:true for each of the four valid hold_state values", () => {
    /**
     * Every value in the HoldState union must be accepted. If any valid state
     * is accidentally excluded from HOLD_STATES, the agent will receive a 400
     * when reporting that specific state and the UI will never see it.
     */
    // GIVEN — iterate the canonical HOLD_STATES so new variants are auto-exercised
    for (const state of HOLD_STATES) {
      // WHEN
      const result = validateHeartbeatBody({ hold_state: state });

      // THEN
      assert.equal(result.ok, true, `expected ok:true for hold_state=${state}`);
    }
  });

  it("returns ok:false for an unrecognized hold_state string", () => {
    /**
     * Unknown hold_state values must be rejected so they never reach the DB.
     * Accepting them would corrupt the hold_state column and break the
     * status UI (bead i38.7) which pattern-matches on the four known values.
     */
    // GIVEN
    const raw = { hold_state: "expired" };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.length > 0, "error message must be non-empty");
    }
  });

  it("returns ok:false when hold_state is missing from the body", () => {
    /**
     * hold_state is the primary payload of every heartbeat. A body without it
     * is malformed — the caller made a protocol error and should receive 400,
     * not 500 (which would suggest a server crash on undefined input).
     */
    // GIVEN
    const raw = { agent_note: "missing hold_state" };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, false);
  });

  it("returns ok:false when hold_state is null", () => {
    /**
     * null is not a valid HoldState value. Permitting it would insert NULL
     * into a column that must always reflect the agent's observed state.
     */
    // GIVEN
    const raw = { hold_state: null };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, false);
  });

  it("returns ok:false when the body is not an object", () => {
    /**
     * The body must be a JSON object. A string, array, or primitive is
     * malformed and must be rejected immediately to prevent crashes on
     * property access in the validation code.
     */
    // GIVEN
    for (const raw of [null, "string", 42, [1, 2, 3]]) {
      // WHEN
      const result = validateHeartbeatBody(raw);

      // THEN
      assert.equal(result.ok, false, `expected ok:false for body=${JSON.stringify(raw)}`);
    }
  });

  it("returns ok:false for a hold_state that is a number, not a string", () => {
    /**
     * hold_state must be a string matching one of the four variants, not a
     * numeric coercion. Accepting 0 or 1 would create confusing bugs where
     * JavaScript coercions happen to pass type checks but fail DB constraints.
     */
    // GIVEN
    const raw = { hold_state: 1 };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, false);
  });

  it("does not include source or status in the returned body", () => {
    /**
     * The heartbeat must only carry hold_state and agent_note. If validation
     * somehow forwarded a source or status field from the raw body to the
     * returned HeartbeatBody, the handler might accidentally SET them in the
     * SQL UPDATE, violating the column-semantics invariant in lib/types.ts.
     */
    // GIVEN
    const raw = { hold_state: "confirmed", source: "evil", status: "released" };

    // WHEN
    const result = validateHeartbeatBody(raw);

    // THEN
    assert.equal(result.ok, true);
    if (result.ok) {
      const body = result.body as Record<string, unknown>;
      assert.equal("source" in body, false, "body must not contain 'source'");
      assert.equal("status" in body, false, "body must not contain 'status'");
    }
  });
});
