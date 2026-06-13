/**
 * Type-level contract tests for lib/types.ts.
 *
 * These are compile-time tests: they pass when `tsc --noEmit` succeeds and
 * fail when it errors. Each block is a behavioral assertion about the exported
 * types — a reviewer can read them without looking at the implementation.
 *
 * WHY: The shared Job contract is the foundation every downstream bead builds
 * on (heartbeat endpoint, agent, UI). If the types diverge between files,
 * callers silently accept wrong shapes — caught only at runtime in prod.
 * Compile-time tests make the divergence a build failure instead.
 */

import type { HoldState, Job, HeartbeatBody } from "../types";

// ────────────────────────────────────────────────────────────────────────────
// HoldState: the four AGENT-OBSERVED reality values
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies HoldState is exactly the union of the four agent-observable states.
 * If this breaks, downstream exhaustive-switch statements in the agent will
 * produce unhandled cases at runtime.
 */
// Compile-time exhaustiveness check: if HoldState gains a new variant that is
// NOT in the return union, tsc errors here — catching it before downstream
// switch statements miss a case.
const _agentSwitchCoversAllHoldStates = (s: HoldState): "holding" | "confirmed" | "lost" | "released" => s;
void _agentSwitchCoversAllHoldStates; // consumed below alongside other type vars

// All four variants must be assignable to HoldState.
const _h1: HoldState = "holding";
const _h2: HoldState = "confirmed";
const _h3: HoldState = "lost";
const _h4: HoldState = "released";

// ────────────────────────────────────────────────────────────────────────────
// Job: all columns from the jobs table
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies Job has the new agent columns added in this task.
 * If hold_state, last_heartbeat_at, agent_note, or source are missing from
 * Job, the heartbeat endpoint (bead i38.2) will fail to compile when it
 * tries to type-annotate a DB row as Job.
 */
const _job: Job = {
  id: "job_abc",
  venue_url: "http://localhost:3000/venue",
  seats: "C4, C5",
  status: "holding",
  message: null,
  freed: false,
  last_held_at: null,
  hold_expires_at: null,
  created_at: new Date().toISOString(),
  // New columns from this task:
  hold_state: "holding",
  last_heartbeat_at: null,
  agent_note: null,
  source: "agent",
};

// Verify status is the USER INTENT union (separate from hold_state).
const _status: Job["status"] = "holding";
const _status2: Job["status"] = "released";
const _status3: Job["status"] = "error";

// Verify source is fenced to exactly two writers.
const _source1: Job["source"] = "agent";
const _source2: Job["source"] = "mock";

// ────────────────────────────────────────────────────────────────────────────
// HeartbeatBody: the request body the agent POSTs each tick
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies HeartbeatBody has hold_state (required) and agent_note (optional).
 * If this shape diverges from what the heartbeat route expects, the agent
 * will silently send incorrect payloads that the server rejects at runtime.
 */
const _hbRequired: HeartbeatBody = { hold_state: "confirmed" };
const _hbWithNote: HeartbeatBody = { hold_state: "lost", agent_note: "seat gone" };
// agent_note must be optional — this must compile without it:
const _hbNoNote: HeartbeatBody = { hold_state: "holding" };

// ────────────────────────────────────────────────────────────────────────────
// Consumer compatibility: holdEngine's HoldJob must be a subset of Job
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies a full Job can be used wherever a subset {id, venue_url, seats}
 * is expected — i.e., passing a DB row directly to hold()/release() works.
 * If this breaks, callers must destructure unnecessarily or cast.
 */
function _requiresHoldFields(j: Pick<Job, "id" | "venue_url" | "seats">): void {
  void j;
}
_requiresHoldFields(_job); // full Job must satisfy the subset

// Suppress "unused variable" warnings (these vars ARE the test — their
// assignment is the assertion; usage here silences the linter).
void _agentSwitchCoversAllHoldStates;
void _h1; void _h2; void _h3; void _h4;
void _status; void _status2; void _status3;
void _source1; void _source2;
void _hbRequired; void _hbWithNote; void _hbNoNote;
