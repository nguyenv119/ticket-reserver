"use client";

import { useEffect, useState, useCallback } from "react";
import type { Job } from "@/lib/types";
import { formatRelativeTime, isHeartbeatStale } from "@/lib/relativeTime";

export default function Control() {
  const [venueUrl, setVenueUrl] = useState("");
  const [seats, setSeats] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  // "now" ticks every 5s so relative heartbeat times stay live without
  // requiring a full data refetch on each tick.
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    const r = await fetch("/api/jobs");
    if (r.ok) setJobs((await r.json()) as Job[]);
  }, []);

  useEffect(() => {
    refresh();
    const dataTimer = setInterval(refresh, 1500);
    return () => clearInterval(dataTimer);
  }, [refresh]);

  useEffect(() => {
    const clockTimer = setInterval(() => setNow(new Date()), 5_000);
    return () => clearInterval(clockTimer);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venueUrl, seats }),
    });
    setSeats("");
    setBusy(false);
    refresh();
  }

  async function release(id: string) {
    await fetch(`/api/jobs/${id}/release`, { method: "POST" });
    refresh();
  }

  const active = jobs.filter((j) => j.status === "holding");

  /** Badge colour for hold_state (agent-observed reality). */
  function holdStateBadgeClass(hs: Job["hold_state"]): string {
    switch (hs) {
      case "confirmed":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300";
      case "holding":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300";
      case "lost":
        return "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300";
      case "released":
        return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
    }
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-10 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">🪄 Seat Holder</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste a ticket link + the seats you found. It holds them forever — until
        you hit Release.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800"
      >
        <label className="block text-sm font-medium">Ticket page URL</label>
        <input
          required
          value={venueUrl}
          onChange={(e) => setVenueUrl(e.target.value)}
          placeholder="http://localhost:3000/venue"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <label className="block text-sm font-medium">Seats</label>
        <input
          required
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          placeholder="C4, C5"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          disabled={busy}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? "Starting…" : "Submit — start holding"}
        </button>
      </form>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Active holds
        </h2>
        {active.length === 0 && (
          <p className="mt-2 text-sm text-neutral-400">Nothing holding yet.</p>
        )}
        <ul className="mt-3 space-y-3">
          {active.map((j) => {
            const stale = isHeartbeatStale(j.last_heartbeat_at, now);
            const heartbeatLabel = formatRelativeTime(j.last_heartbeat_at, now);
            const neverHeartbeated = j.last_heartbeat_at === null;

            return (
              <li
                key={j.id}
                className="rounded-xl border border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
              >
                {/* Stale warning banner — only shown when agent missed a tick */}
                {stale && (
                  <div className="flex items-center gap-2 rounded-t-xl border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-900 dark:bg-red-950/60">
                    <span className="text-red-500">⚠</span>
                    <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                      Agent heartbeat stale — last seen {heartbeatLabel}. Seats
                      may be at risk.
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {/* Seats + animated pulse */}
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="font-semibold">{j.seats}</span>
                    </div>

                    {/* message line */}
                    {j.message && (
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {j.message}
                      </p>
                    )}

                    {/* Engine health row */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {/* status = USER INTENT */}
                      <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          Status:
                        </span>
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                          {j.status}
                        </span>
                      </span>

                      {/* hold_state = AGENT REALITY */}
                      <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          Agent state:
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${holdStateBadgeClass(j.hold_state)}`}
                        >
                          {j.hold_state}
                        </span>
                      </span>

                      {/* heartbeat */}
                      <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          Heartbeat:
                        </span>
                        {neverHeartbeated ? (
                          <span className="italic text-neutral-400">
                            {heartbeatLabel}
                          </span>
                        ) : stale ? (
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            {heartbeatLabel}
                          </span>
                        ) : (
                          <span className="text-neutral-600 dark:text-neutral-400">
                            {heartbeatLabel}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* agent_note — shown when present */}
                    {j.agent_note && (
                      <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          Note:
                        </span>{" "}
                        {j.agent_note}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => release(j.id)}
                    className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                  >
                    Release
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-10 text-center text-xs text-neutral-400">
        Watch the seats live on the{" "}
        <a href="/venue" className="underline">
          ticket page →
        </a>
      </p>
    </main>
  );
}
