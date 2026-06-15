"use client";

import { useState, useRef, useEffect } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setSuccess(true);
        // Hard redirect so the signed cookie is picked up by the browser.
        window.location.href = "/";
      } else {
        setError(true);
        setPassword("");
        setBusy(false);
        inputRef.current?.focus();
      }
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-10 font-sans">
      {/* Header — mirrors the main page's h1 */}
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5 shrink-0 text-neutral-400"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
            clipRule="evenodd"
          />
        </svg>
        <h1 className="text-2xl font-semibold tracking-tight">Seat Holder</h1>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Enter the password to access your seat-holding dashboard.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800"
      >
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          ref={inputRef}
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(false);
          }}
          disabled={busy || success}
          placeholder="••••••••••••"
          className={[
            "w-full rounded-lg border px-3 py-2 text-sm outline-none transition",
            "dark:bg-neutral-900",
            error
              ? "border-red-400 focus:border-red-500 dark:border-red-700"
              : "border-neutral-300 focus:border-neutral-900 dark:border-neutral-700",
            "disabled:opacity-50",
          ].join(" ")}
        />

        {error && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            Wrong password — try again.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || success}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
        >
          {success ? "Redirecting…" : busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
