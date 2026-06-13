# External services in this repo

Two access patterns live side-by-side; pick the one that matches your surface. Credentials are the same in both — only the wrapper differs:

- **Local Claude Code** (your laptop) — wrapped via MCP servers in `~/.claude.json` (user-level, not committed). The full set of raw tokens also lives in `.claude/.env` (gitignored), which is the canonical session env the smoke test reads first.
- **Cloud Claude Code** behind the Claudespectus Slack bot — raw REST/SDK calls reading from the slackbot's own `.env`. The slackbot lives in the sibling `claudespectus/` directory (`claudespectus/.env`, gitignored), **not** `apps/slackbot/` (that path is stale — it only survives in a couple of old worktrees).

Tokens never live in this file or anywhere else committed. If you need a token, look in `.claude/.env` (canonical, holds every var), `~/.claude.json` (local MCP wiring), or `claudespectus/.env` (slackbot deployment). Never paste tokens into committed files. Never echo full tokens in chat. Never put them in URL params.

**Verify access at any time** with `bash .claude/smoke-test.sh` (or the `/smoke-test` slash command). Runs an auth probe against each service below and reports PASS/FAIL/SKIP/KNOWN.

---

## Notion

Use the plugin Notion MCP (`mcp__plugin_Notion_notion__*`). Do not use the `mcp__8ef108dd-*` MCP or the browser.

Workspace: **Conspectus Space** (`workspace_id: 6854ef5d-9120-819a-b7cf-0003930a2681`) — not Jennifer's Space (old), not Long Nguyen's Space.

For headless agents without OAuth, use `NOTION_INTEGRATION_TOKEN` with the Notion REST API (`https://api.notion.com/v1/`, header `Notion-Version: 2022-06-28`). The current integration is the workspace-owned **"ClaudeCode"** (capabilities: Read + Update + Insert content, Read user info with email).

**Sharing model** — the integration only sees pages it's been **connected to** in Notion (page → ••• → Connections → ClaudeCode). Once connected, all *descendants* are also visible. Top-level pages CAN be shared individually, but **a brand-new page that hasn't been connected is invisible** to the API and search.

Practical rules:
- Prefer creating new pages **under an already-connected parent** so they're auto-visible.
- If you create at workspace root, you (or a routine) must connect it explicitly — until then `/v1/search` won't return it and `pages.retrieve` will 404.
- Integration management page: https://app.notion.com/developers/connections/3734ef5d-9120-81b7-a78b-0027a5fb08f8 → "Content access" tab.

## Slack

Workspace: **Conspectus** (`team_id: T0A76BEH13M`, host `conspectus-workspace.slack.com`).

Three tokens, stored in `.claude/.env` (canonical) and mirrored in `claudespectus/.env` (slackbot deployment):

- `SLACK_BOT_TOKEN` (xoxb-…) — acts as the **Claudespectus** bot. 20 scopes including `channels:history` / `:read` / `:join`, `groups:history` / `:read`, `im:history` / `:write`, `mpim:history`, `files:read`, `reactions:read`, `users:read.email`, `pins:read`, `links:read`, `team:read`, `bookmarks:read`, `chat:write`, `commands`, `app_mentions:read`.
- `SLACK_USER_TOKEN` (xoxp-…) — acts as **Long**, **read-only**. Scopes: `identify, channels:history, channels:read, groups:history, groups:read, im:history, im:read, mpim:history, mpim:read, search:read, users:read`. Use for **workspace-wide search** (`search.messages`); bot tokens cannot call that endpoint. **Does NOT have `chat:write`** — `chat.postMessage` will fail with `missing_scope: chat:write:bot`. If a script needs to post AS Long via this token, add `chat:write` to **User Token Scopes** at https://api.slack.com/apps → Claudespectus → OAuth & Permissions, reinstall, re-auth, and rotate the token in `.claude/.env`.

**Posting as Long, today**: use the `mcp__7f32962b-…__slack_send_message` MCP — this is the **@Claude Slack integration** OAuth (separate from `SLACK_USER_TOKEN`), authed as user `U0B2D5XSJB1` with `chat:write`. Use this to `<@bot>` and trigger `app_mention` events. Bot self-mentions via `SLACK_BOT_TOKEN` do NOT fire `app_mention` — confirmed in code at [slack-handlers.ts:195](claudespectus/src/slack-handlers.ts:195) and verified empirically.
- `SLACK_APP_TOKEN` (xapp-…) — Socket Mode; slackbot only.

The bot must be `/invite`d to a channel to read its history (even with `channels:history`). It has `channels:join` so it can self-add to public channels.

Local MCP: `slack-mcp-server` (korotovsky), wired in `~/.claude.json`. Tools include `conversations_history`, `conversations_replies`, `conversations_search_messages`, `channels_list`, `users_search`, plus posting and reactions enabled.

## AWS

Account: Conspectus org master `342137540917`. IAM user `long-dev` — **scoped to Bedrock only** (no S3, EC2, Lambda, IAM read).

Env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1`.

For Claude Code's own LLM calls, set `CLAUDE_CODE_USE_BEDROCK=1` and `ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-6` (or another listed Bedrock model — Opus 4.5–4.8, Sonnet 4 / 4.5 / 4.6, Haiku 4.5).

⚠️ Sub-account `770762663218` carries a separate root access key. Do not use it — slated for deletion.

## Granola

Public API base: **`https://public-api.granola.ai`** (not `api.granola.ai` — that's the desktop app's internal Cognito-auth'd endpoint, do NOT use it). Endpoints: `GET /v1/notes`, `GET /v1/notes/{id}`, `GET /v1/folders`.

Auth: `Authorization: Bearer $GRANOLA_API_KEY`. Generate keys at Granola desktop → Settings → Connectors → API keys; scopes are **Personal notes** + **Public notes** (workspace member access).

Local OAuth alternative: the Granola MCP at `https://mcp.granola.ai/mcp` is configured in this project's `.mcp.json` and works interactively; the REST key is what cloud / headless callers use.

Docs index: `https://docs.granola.ai/llms.txt`. OpenAPI: `https://docs.granola.ai/api-reference/openapi.json`.

## Vercel

Team **Conspectus** (`team_UV5gBGLeZaz7tK4gdcn5E8Op`, slug `conspectus`). Long is a MEMBER, not OWNER — team-admin actions may be restricted.

Project: `conspectus` (`prj_e4VzgiDuGh1Z9rXzUDJiDHdq0pvh`).

Env var: `VERCEL_TOKEN`. Use the `vercel` CLI or REST against `api.vercel.com/v9/projects/…`. The `VERCEL_OIDC_TOKEN` in `.env.development` is short-lived and auto-managed — ignore it.

## Neon

Project: `young-term-18536146` ("Conspectus"), org `org-empty-fog-10063726`, PostgreSQL 18, `aws-us-east-1`, 50+ branches with `production` as the default (the smoke test reports the live count).

Env var: `NEON_API_KEY` (`napi_…`) — **project-scoped by design**. It cannot list other projects or call `/users/me`; that's a feature, not a bug.

Use `neonctl` or REST against `https://console.neon.tech/api/v2/projects/young-term-18536146/…`. For branch/migration workflow inside the monorepo, see `packages/db/CLAUDE.md`.

## GitHub

Org `Conspectus-Intel`. Repos: `conspectus`, `iwr`, `conspectus-py`, `conspectus-ts`, `conspectus-figure-focus`, `the_conspectus`, `the_conspectus_pipeline`.

Env var: `GITHUB_TOKEN` (or `GH_TOKEN`) — fine-grained PAT with admin on all 7 org repos. **Expires 2026-06-19** — rotate before then.

`gh` CLI auto-authes from `GH_TOKEN`. Prefer `gh` over raw `git push` for cross-repo work (issues, PRs, releases, API).

## TwitterAPI.IO

Used by `tools/twitter-bot/` (see `search_tweets.py`).

Env var: `TWITTERAPI_IO_KEY` (`new1_…`). Auth via header `x-api-key`. Base `https://api.twitterapi.io/`. Common endpoint: `/twitter/tweet/advanced_search`.

## Trigger.dev

Powers the prod task pipeline in `conspectus/apps/trigger/` (scheduled tasks: `poll-twitter-feeds`, `poll-rss-feeds`, `listener-fanout`, etc.).

Org `conspectus-18c2`, project `conspectus-vDOC`. Dashboard: https://cloud.trigger.dev/orgs/conspectus-18c2/projects/conspectus-vDOC

The project has four environments — **Development**, Staging, Preview, and Production — each with its own scoped API key (`tr_<env>_…`). The smoke test verifies prod + dev independently.

**Two coexisting variable conventions:**

- **`TRIGGER_SECRET_KEY` (single canonical name)** — what the Trigger.dev SDK reads at runtime. App code (`apps/trigger`, anything via `scripts/with-dev-env.ts`) consumes this one variable. Locally it holds the **dev** key (in each worktree's `.env.development.local`); on Railway / Vercel it holds the prod key. The SDK never asks "which env am I?" — it just trusts whatever's in this single var.
- **`TRIGGER_PROD_SECRET_KEY` + `TRIGGER_DEV_SECRET_KEY` (diagnostic names)** — held side-by-side in `.claude/.env`. Only the smoke test reads them. The point is to test BOTH credentials independently in one run, without having to swap the canonical var.

Dev keys are personal — Trigger.dev explicitly warns *"every team member gets their own dev Secret key. Make sure you're using the one above otherwise you will trigger runs on your team member's machine."* So the dev key in `.env.development.local` is per-developer; the explicit `TRIGGER_DEV_SECRET_KEY` in `.claude/.env` is yours.

To get a key: dashboard → environment → API keys → click the secret-key copy icon. URLs:
- Prod: https://cloud.trigger.dev/orgs/conspectus-18c2/projects/conspectus-vDOC/env/prod/apikeys
- Dev: https://cloud.trigger.dev/orgs/conspectus-18c2/projects/conspectus-vDOC/env/dev/apikeys

⚠️ **API base is `https://api.trigger.dev`** — NOT `cloud.trigger.dev` (that's the dashboard only). Auth via header `Authorization: Bearer $TRIGGER_SECRET_KEY`. List recent runs: `GET /api/v1/runs?page[size]=N`. The `env.name` field on each run confirms which env the key is scoped to.

A richer account-wide path exists (Personal Access Token `tr_pat_…` → Management API + official trigger.dev MCP) but is not configured; the env-scoped secret keys are what local/headless callers use.

---

## Railway

Project: **claudespectus** — the Slack bot deployment. Dashboard: https://railway.com

Env var: `RAILWAY_TOKEN` — a personal API token (not an OAuth token). Generate at railway.com → Account Settings → Tokens → New Token. Scopes: project-level read/write is sufficient for deploy status and log queries.

Use the Railway GraphQL API (`https://backboard.railway.app/graphql/v2`, `Authorization: Bearer $RAILWAY_TOKEN`) for headless access. The CLI (`railway`) uses OAuth from `~/.railway/config.json` and works locally but NOT in headless/bot contexts.

**What works with a personal API token:**
- `{ projects { edges { node { id name services { edges { node { id name } } } } } } }` — list projects and their services ✓
- Schema introspection (`__schema`, `__typename`) ✓

**What does NOT work (returns "Not Authorized"):**
- `{ me { ... } }` — personal tokens cannot call `me`; only OAuth/session tokens can
- `{ apiTokens { ... } }` — same restriction

The smoke test uses the `projects` query (not `me`) and verifies the `claudespectus` project is visible as a tripwire. If `me` is needed in future, use the Railway CLI (OAuth) or a session token from the dashboard.

The bot container also receives `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_DEPLOYMENT_ID` automatically from Railway at runtime — these are read-only deployment identifiers, distinct from `RAILWAY_TOKEN`.

Add `RAILWAY_TOKEN` to `.claude/.env` (canonical) AND `claudespectus/.env` (slackbot deployment) so both the smoke test and bot have access.

---

## Where tokens live

| Surface | File | In git? |
|---|---|---|
| Canonical / headless REST + smoke test | `.claude/.env` (full set of every var) | No (`.env*` gitignored) |
| Local Claude Code MCP | `~/.claude.json` → `projects."/Users/nguyenv/conspectus".mcpServers.*.env` | No (user-level) |
| Cloud Claude Code / slackbot | `claudespectus/.env` (was `apps/slackbot/.env` — stale) | No (`.env*` gitignored) |
| Web app local dev | `conspectus/.env.development(.local)` | No (`.env*` gitignored) |
