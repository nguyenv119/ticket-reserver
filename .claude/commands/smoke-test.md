# /smoke-test

Verify access to every external service this repo touches. Each check returns one piece of live data so the test doubles as a snapshot.

## Expected output — 14 checks

Compare your run against this table. If a check is missing, returning a different shape, or marked as `[SKIP]` when it shouldn't be, **investigate before reporting healthy**.

Each check has two parts: a **tripwire** (what makes it FAIL beyond just "credential missing") and a **PASS line** the agent reads to extract live state.

| # | Service | Tripwire (FAILs if…) | PASS line shape |
|---|---|---|---|
| 1 | `Notion`      | workspace != `Conspectus Space` | `ClaudeCode @ Conspectus Space — latest: "<page title>"` |
| 2 | `Slack bot`   | `team_id` != `T0A76BEH13M` | `team=Conspectus, bot=conspectipated, sees N public channels: #...` |
| 3 | `Slack user`  | `team_id` != `T0A76BEH13M` | `acting as=vlpnguyen119 — latest in #<channel>: "<msg>…"` |
| 4 | `AWS`         | account != `342137540917` OR ARN missing `long-dev` | `acct=342137540917, user/long-dev` |
| 5 | `Bedrock`     | `$ANTHROPIC_MODEL` not in `us-east-1` list | `N Claude models, target=<model> (available ✓)` |
| 6 | `AWS scope`   | EC2 or S3 *accessible* (over-privileged) | `EC2 denied ✓, S3 denied ✓ (long-dev is Bedrock-only)` — **negative test** |
| 7 | `Granola`     | latest note owner not on `@theconspectus.com` | `N folders, latest note: "<title>" (<owner email>)` |
| 8 | `Vercel`      | token sees no deploys for the Conspectus team's `conspectus` project | `user=…, latest deploy: <url> [<state>, <date>, Nd ago]` |
| 9 | `Neon`        | project name != `Conspectus` OR default branch != `production` | `Conspectus, pg=18, aws-us-east-1, N branches (default: production)` |
| 10 | `GitHub`     | no access to `Conspectus-Intel/conspectus` OR PAT expired | `user=nguyenv119, expires=<date> (<N>d left) — conspectus@main: <sha> "<msg>" (<date>)` |
| 11 | `Twitter API`| `credits <= 0` | `credits=<n>, sample @jack followers=<n>` |
| 12 | `Trigger.dev prod` | latest run's `env.name` != `prod` (wrong key loaded) | `env=prod, N recent runs — latest: <task> (<status>)` |
| 13 | `Trigger.dev dev`  | latest run's `env.name` != `dev` (wrong key loaded) | `env=dev, N recent runs — latest: <task> (<status>)` (a dev key with 0 runs still PASSes — token accepted, just unused) |
| 14 | `Railway`    | `claudespectus` project not visible | `projects: claudespectus (N services)` |

**Agent-useful signals to read off the PASS lines:**
- GitHub PAT `(<N>d left)` — if `< 30`, mention rotation when the user next touches GitHub workflows.
- Vercel `<N>d ago` — if a "latest" deploy is days old on a branch you'd expect to be active, flag it.
- Bedrock model name — the live target the slackbot will use.
- Neon branch count + default — sanity check before running migrations.

**Healthy state:** `14 pass, 0 fail, 0 skip, 0 known-fail` and exit code 0.

Anything else — even a single SKIP or KNOWN — should trigger investigation. See [`feedback-smoke-test-design`](../../.claude/projects/-Users-nguyenv-conspectus/memory/feedback_smoke_test_design.md) for the design principles.

## What to do

1. Run the script:
   ```bash
   bash /Users/nguyenv/conspectus/.claude/smoke-test.sh
   ```
2. Report the results table verbatim to the user.
3. **Interpret** the output:
   - `PASS`  — service is reachable with the configured credential.
   - `FAIL`  — credential exists but the call failed. **Investigate** — read the detail message, check token expiry, check scope.
   - `SKIP`  — the env var isn't set yet. Tell the user *which file* to add it to (the script header lists the load order: `apps/slackbot/.env`, `~/.claude.json`, etc.).
   - `KNOWN` — known-failing, intentionally not counted as a failure (e.g. Granola until keys are regenerated).
4. If any `FAIL` is present, propose a fix before doing other work — a broken credential will cascade.
5. If the user just wants a machine-readable status, run with `--json`:
   ```bash
   bash /Users/nguyenv/conspectus/.claude/smoke-test.sh --json
   ```

## When to run

- First action in a new session if external service access is in question.
- After rotating any token.
- After Jennifer or Long reinstalls / regenerates anything.
- Before flipping a "we're ready to ship" switch.

## Don't

- Don't echo full token values back to the user.
- Don't edit `smoke-test.sh` to skip a `FAIL` — fix the underlying credential instead.
- Don't add this to the `SessionStart` hook without asking the user first — it makes network calls and adds latency.
