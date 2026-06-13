"use client";

import { useEffect, useState, useCallback } from "react";
import type { Job } from "@/lib/types";

export default function Control() {
  const [venueUrl, setVenueUrl] = useState("");
  const [seats, setSeats] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/jobs");
    if (r.ok) setJobs(await r.json());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

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
          {active.map((j) => (
            <li
              key={j.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="font-semibold">{j.seats}</span>
                </div>
                <p className="truncate text-xs text-neutral-500">{j.message}</p>
              </div>
              <button
                onClick={() => release(j.id)}
                className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                Release
              </button>
            </li>
          ))}
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
