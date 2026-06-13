"use client";

import { useEffect, useState, useCallback } from "react";

type Seat = {
  seat: string;
  status: "available" | "held";
  secs_left: number | null;
};

export default function Venue() {
  const [seats, setSeats] = useState<Seat[]>([]);

  const load = useCallback(async () => {
    const r = await fetch("/api/venue/state");
    if (r.ok) setSeats(await r.json());
  }, []);

  useEffect(() => {
    // Seed the grid once, then poll fast so countdowns look live.
    fetch("/api/venue/seed", { method: "POST" }).then(load);
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [load]);

  const rows = [...new Set(seats.map((s) => s.seat[0]))].sort();

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 font-sans">
      <p className="text-xs uppercase tracking-widest text-neutral-400">
        Mock Cinema · Screen 3
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Choose your seats</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Held seats show a countdown. They free themselves when the timer hits 0
        — unless something keeps re-holding them…
      </p>

      <div className="mt-8 rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
        <div className="mx-auto mb-6 h-1.5 w-3/4 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <p className="mb-5 text-center text-[10px] uppercase tracking-widest text-neutral-400">
          screen
        </p>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row} className="flex items-center justify-center gap-2">
              <span className="w-4 text-xs text-neutral-400">{row}</span>
              {seats
                .filter((s) => s.seat[0] === row)
                .map((s) => {
                  const held = s.status === "held";
                  return (
                    <div
                      key={s.seat}
                      title={s.seat}
                      className={
                        "flex h-9 w-9 flex-col items-center justify-center rounded-md text-[10px] font-medium transition " +
                        (held
                          ? "bg-red-500 text-white"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300")
                      }
                    >
                      {held ? (
                        <span className="tabular-nums">{s.secs_left}s</span>
                      ) : (
                        s.seat.slice(1)
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-center gap-5 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-emerald-300" /> available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-red-500" /> reserved (timer)
          </span>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">
        ← back to the{" "}
        <a href="/" className="underline">
          control app
        </a>
      </p>
    </main>
  );
}
