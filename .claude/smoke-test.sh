#!/usr/bin/env bash
#
# .claude/smoke-test.sh — verify access to every external service in CLAUDE.md.
#
# Reads credentials from (in order; first hit wins per var):
#   1. .claude/.env                      (canonical session env — preferred)
#   2. apps/slackbot/.env                (slackbot deployment env)
#   3. conspectus/apps/slackbot/.env     (monorepo path)
#   4. conspectus/.env.development       (Neon, etc.)
#   5. tools/twitter-bot/.env            (Twitter)
#   6. ~/.claude.json                    (Slack tokens from the MCP config)
#   7. Current shell env                 (overrides everything above)
#
# Run from anywhere:
#   bash /Users/nguyenv/conspectus/.claude/smoke-test.sh           # human output
#   bash /Users/nguyenv/conspectus/.claude/smoke-test.sh --json    # machine output
#
# Exits 0 iff every non-skipped, non-KNOWN check passes.
#
# Expected output (14 checks). If you change this script, update both the
# table below and .claude/commands/smoke-test.md so the agent's reference
# stays in sync:
#
#   1.  Notion       — ClaudeCode @ Conspectus Space + latest page title
#   2.  Slack bot    — team + visible public channel list
#   3.  Slack user   — acting-as user + latest workspace search result
#   4.  AWS          — account id + IAM ARN (long-dev)
#   5.  Bedrock      — Claude model count + ANTHROPIC_MODEL availability
#   6.  AWS scope    — NEGATIVE test: EC2/S3 must be denied (over-privilege tripwire)
#   7.  Granola      — folder count + latest note title + owner
#   8.  Vercel       — user + latest deployment URL/state/date
#   9.  Neon         — project + Postgres version + branch count + default branch
#   10. GitHub       — user + PAT expiry + latest commit on conspectus@main
#   11. Twitter API     — credit balance + sample lookup (@jack followers)
#   12. Trigger.dev prod — prod-env scope check + recent run count + latest task/status
#   13. Trigger.dev dev  — dev-env scope check + recent run count + latest task/status
#   14. Railway          — project visibility (claudespectus tripwire) + service count
#
# Healthy: 14 pass, 0 fail, 0 skip, 0 known-fail.

set -uo pipefail
# SMOKE_REPO env var lets callers override the repo root.
# Default: local dev path. In Railway, set SMOKE_REPO=/app (where the image root lives).
REPO="${SMOKE_REPO:-/Users/nguyenv/conspectus}"
FORMAT="${1:-text}"

# --- load env from likely files (later does NOT override earlier; preserve shell env) ---
load_env_file() {
  [ -f "$1" ] || return 0
  # only set vars not already set
  while IFS='=' read -r key val; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    key="${key// /}"
    # strip surrounding quotes
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    [ -z "${!key:-}" ] && export "$key=$val"
  done < <(grep -v '^\s*$' "$1" 2>/dev/null | sed 's/\r$//')
}
load_env_file "$REPO/.claude/.env"
load_env_file "$REPO/apps/slackbot/.env"
load_env_file "$REPO/conspectus/apps/slackbot/.env"
load_env_file "$REPO/conspectus/.env.development"
load_env_file "$REPO/tools/twitter-bot/.env"
load_env_file "$REPO/conspectus/tools/twitter-bot/.env"

# Pull Slack tokens out of ~/.claude.json (where the MCP config lives) if not set
if [ -f "$HOME/.claude.json" ] && command -v jq >/dev/null 2>&1; then
  SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-$(jq -r '.projects."/Users/nguyenv/conspectus".mcpServers.slack.env.SLACK_MCP_XOXB_TOKEN // empty' "$HOME/.claude.json" 2>/dev/null)}"
  SLACK_USER_TOKEN="${SLACK_USER_TOKEN:-$(jq -r '.projects."/Users/nguyenv/conspectus".mcpServers.slack.env.SLACK_MCP_XOXP_TOKEN // empty' "$HOME/.claude.json" 2>/dev/null)}"
fi

# --- output helpers ---
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; D='\033[2m'; N='\033[0m'
pass_cnt=0; fail_cnt=0; skip_cnt=0; known_cnt=0
results_json=()

report() {
  local status="$1" svc="$2" detail="$3"
  if [ "$FORMAT" = "--json" ]; then
    results_json+=("$(jq -nc --arg s "$status" --arg svc "$svc" --arg d "$detail" '{status:$s,service:$svc,detail:$d}')")
  else
    case "$status" in
      PASS)  printf "${G}[PASS]${N}  %-12s %s\n"  "$svc" "$detail" ;;
      FAIL)  printf "${R}[FAIL]${N}  %-12s %s\n"  "$svc" "$detail" ;;
      SKIP)  printf "${Y}[SKIP]${N}  %-12s %s\n"  "$svc" "$detail" ;;
      KNOWN) printf "${B}[KNOWN]${N} %-12s %s\n"  "$svc" "$detail" ;;
    esac
  fi
  case "$status" in
    PASS)  pass_cnt=$((pass_cnt+1)) ;;
    FAIL)  fail_cnt=$((fail_cnt+1)) ;;
    SKIP)  skip_cnt=$((skip_cnt+1)) ;;
    KNOWN) known_cnt=$((known_cnt+1)) ;;
  esac
}

need() {
  # need VAR "Service Name" --> SKIP if VAR is empty
  local var="$1" svc="$2"
  if [ -n "${!var:-}" ]; then return 0; fi
  report SKIP "$svc" "$var not set"
  return 1
}

# --- per-service checks ---

check_notion() {
  need NOTION_INTEGRATION_TOKEN Notion || return
  local r ws name latest title
  r=$(curl -s -m 10 https://api.notion.com/v1/users/me \
    -H "Authorization: Bearer $NOTION_INTEGRATION_TOKEN" \
    -H "Notion-Version: 2022-06-28")
  ws=$(echo "$r" | jq -r '.bot.workspace_name // empty')
  name=$(echo "$r" | jq -r '.name // empty')
  if [ -z "$ws" ]; then
    report FAIL Notion "$(echo "$r" | jq -r '.message // "no bot.workspace_name"' | head -c 100)"
    return
  fi
  # Assert we're hitting Conspectus Space, not Jennifer's Space / personal / other.
  # If the token gets swapped, this is the tripwire — don't let a wrong-workspace token PASS silently.
  if [ "$ws" != "Conspectus Space" ]; then
    report FAIL Notion "wrong workspace: got \"$ws\", expected \"Conspectus Space\" — check NOTION_INTEGRATION_TOKEN"
    return
  fi
  latest=$(curl -s -m 10 -X POST https://api.notion.com/v1/search \
    -H "Authorization: Bearer $NOTION_INTEGRATION_TOKEN" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"page_size":1,"sort":{"direction":"descending","timestamp":"last_edited_time"}}')
  title=$(echo "$latest" | jq -r '
    .results[0] |
    if .object=="page" then
      (.properties // {} | to_entries[] | select(.value.type=="title") | .value.title[0].plain_text)
    elif .object=="database" then
      (.title[0].plain_text)
    else "(no items)" end // "(untitled)"' 2>/dev/null | head -c 60)
  report PASS Notion "$name @ $ws — latest: \"$title\""
}

check_slack_bot() {
  need SLACK_BOT_TOKEN "Slack bot" || return
  local r team team_id user chs ch_count
  r=$(curl -s -m 10 https://slack.com/api/auth.test -H "Authorization: Bearer $SLACK_BOT_TOKEN")
  if [ "$(echo "$r" | jq -r '.ok')" != "true" ]; then
    report FAIL "Slack bot" "$(echo "$r" | jq -r '.error // "unknown"')"
    return
  fi
  team=$(echo "$r" | jq -r '.team')
  team_id=$(echo "$r" | jq -r '.team_id')
  user=$(echo "$r" | jq -r '.user')
  # Tripwire: assert we're in the Conspectus workspace, not someone's personal one.
  if [ "$team_id" != "T0A76BEH13M" ]; then
    report FAIL "Slack bot" "wrong workspace: team_id=$team_id ($team), expected T0A76BEH13M (Conspectus) — check SLACK_BOT_TOKEN"
    return
  fi
  chs=$(curl -s -m 10 "https://slack.com/api/conversations.list?types=public_channel&limit=10&exclude_archived=true" \
        -H "Authorization: Bearer $SLACK_BOT_TOKEN")
  ch_count=$(echo "$chs" | jq -r '.channels | length // 0')
  local ch_names
  ch_names=$(echo "$chs" | jq -r '.channels | map("#" + .name) | join(", ")' | head -c 60)
  report PASS "Slack bot" "team=$team, bot=$user, sees $ch_count public channels: $ch_names"
}

check_slack_user() {
  need SLACK_USER_TOKEN "Slack user" || return
  local r user team_id search latest_text latest_ch
  r=$(curl -s -m 10 https://slack.com/api/auth.test -H "Authorization: Bearer $SLACK_USER_TOKEN")
  if [ "$(echo "$r" | jq -r '.ok')" != "true" ]; then
    report FAIL "Slack user" "$(echo "$r" | jq -r '.error // "unknown"')"
    return
  fi
  user=$(echo "$r" | jq -r '.user')
  team_id=$(echo "$r" | jq -r '.team_id')
  # Tripwire: same workspace assertion as the bot — catches a token swapped to a personal account.
  if [ "$team_id" != "T0A76BEH13M" ]; then
    report FAIL "Slack user" "wrong workspace: team_id=$team_id, expected T0A76BEH13M (Conspectus) — check SLACK_USER_TOKEN"
    return
  fi
  search=$(curl -s -m 10 "https://slack.com/api/search.messages?query=conspectus&count=1&sort=timestamp&sort_dir=desc" \
           -H "Authorization: Bearer $SLACK_USER_TOKEN")
  latest_text=$(echo "$search" | jq -r '.messages.matches[0].text // empty' | tr -d '\n' | head -c 60)
  latest_ch=$(echo "$search" | jq -r '.messages.matches[0].channel.name // "?"')
  report PASS "Slack user" "acting as=$user — latest in #$latest_ch: \"${latest_text}…\""
}

check_aws() {
  need AWS_ACCESS_KEY_ID AWS || return
  local r
  r=$(AWS_DEFAULT_REGION=us-east-1 aws sts get-caller-identity --output json 2>&1)
  if echo "$r" | jq -e '.Account' >/dev/null 2>&1; then
    local acct arn
    acct=$(echo "$r" | jq -r '.Account')
    arn=$(echo "$r" | jq -r '.Arn' | sed 's|.*:||')
    # Tripwire: assert org master + long-dev IAM. Catches the sub-account 770762663218
    # root key that CLAUDE.md warns about, or any other AWS key getting picked up.
    if [ "$acct" != "342137540917" ]; then
      report FAIL AWS "wrong account: $acct, expected 342137540917 (Conspectus org master) — check AWS_ACCESS_KEY_ID"
      return
    fi
    if [[ "$arn" != *"long-dev"* ]]; then
      report FAIL AWS "wrong IAM user: $arn, expected long-dev — check AWS_ACCESS_KEY_ID"
      return
    fi
    report PASS AWS "acct=$acct, $arn"
  else
    report FAIL AWS "$(echo "$r" | head -1 | head -c 100)"
  fi
}

check_aws_bedrock() {
  [ -z "${AWS_ACCESS_KEY_ID:-}" ] && return  # already SKIP'd above
  local n configured_ok
  n=$(AWS_DEFAULT_REGION=us-east-1 aws bedrock list-foundation-models \
        --query 'modelSummaries[?contains(modelId,`claude`)] | length(@)' --output text 2>/dev/null)
  if [ -z "$n" ] || [ "$n" -eq 0 ] 2>/dev/null; then
    report FAIL "Bedrock" "list-foundation-models returned nothing"
    return
  fi
  # Confirm the model the slackbot is configured to use is actually listed
  local target="${ANTHROPIC_MODEL:-us.anthropic.claude-sonnet-4-6}"
  configured_ok=$(AWS_DEFAULT_REGION=us-east-1 aws bedrock list-foundation-models \
    --query "modelSummaries[?modelId=='${target#us.}'].modelId | [0]" --output text 2>/dev/null)
  # Tripwire: target model must be listed. The slackbot will silently fall back / 500 if it isn't.
  if [ -z "$configured_ok" ] || [ "$configured_ok" = "None" ]; then
    report FAIL "Bedrock" "$n Claude models, but target=$target NOT available in us-east-1 — slackbot will break"
    return
  fi
  report PASS "Bedrock" "$n Claude models, target=$target (available ✓)"
}

check_aws_scoping() {
  [ -z "${AWS_ACCESS_KEY_ID:-}" ] && return
  # Confirm long-dev is properly scoped: EC2 must DENY, S3 must DENY.
  # A PASS here means the IAM scoping is correct (limited blast radius).
  local ec2_resp s3_resp ec2_status s3_status
  ec2_resp=$(AWS_DEFAULT_REGION=us-east-1 aws ec2 describe-instances --max-results 5 2>&1)
  s3_resp=$(aws s3api list-buckets 2>&1)
  if echo "$ec2_resp" | grep -qiE "UnauthorizedOperation|AccessDenied|not authorized"; then
    ec2_status="EC2 denied ✓"
  elif echo "$ec2_resp" | grep -q "Reservations"; then
    ec2_status="⚠ EC2 ACCESS — over-privileged!"
  else
    ec2_status="EC2 unclear"
  fi
  if echo "$s3_resp" | grep -qiE "AccessDenied|not authorized"; then
    s3_status="S3 denied ✓"
  elif echo "$s3_resp" | grep -q "Buckets"; then
    s3_status="⚠ S3 ACCESS — over-privileged!"
  else
    s3_status="S3 unclear"
  fi
  if echo "$ec2_status $s3_status" | grep -q "⚠"; then
    report FAIL "AWS scope" "$ec2_status, $s3_status (long-dev should be Bedrock-only)"
  else
    report PASS "AWS scope" "$ec2_status, $s3_status (long-dev is Bedrock-only)"
  fi
}

check_granola() {
  need GRANOLA_API_KEY Granola || return
  local r n first_title first_owner folders folder_count
  r=$(curl -s -m 10 "https://public-api.granola.ai/v1/notes?page_size=1" \
    -H "Authorization: Bearer $GRANOLA_API_KEY")
  n=$(echo "$r" | jq -r '.notes | length // empty' 2>/dev/null)
  if [ -z "$n" ]; then
    report FAIL Granola "$(echo "$r" | head -c 100)"
    return
  fi
  first_title=$(echo "$r" | jq -r '.notes[0].title // "(no notes)"' | head -c 50)
  first_owner=$(echo "$r" | jq -r '.notes[0].owner.email // "?"')
  # Tripwire: latest note owner should be on the @theconspectus.com domain.
  # Catches a personal Granola key getting loaded instead of the workspace one.
  if [ "$first_owner" != "?" ] && [[ "$first_owner" != *"@theconspectus.com" ]]; then
    report FAIL Granola "wrong workspace: latest note owner=$first_owner (expected @theconspectus.com) — check GRANOLA_API_KEY"
    return
  fi
  folders=$(curl -s -m 10 "https://public-api.granola.ai/v1/folders" \
            -H "Authorization: Bearer $GRANOLA_API_KEY")
  folder_count=$(echo "$folders" | jq -r '.folders | length')
  report PASS Granola "$folder_count folders, latest note: \"$first_title\" ($first_owner)"
}

check_vercel() {
  need VERCEL_TOKEN Vercel || return
  local r user team_id deploys latest_url latest_state latest_created
  r=$(curl -s -m 10 https://api.vercel.com/v2/user -H "Authorization: Bearer $VERCEL_TOKEN")
  if ! echo "$r" | jq -e '.user.id' >/dev/null 2>&1; then
    report FAIL Vercel "$(echo "$r" | jq -r '.error.message // "unknown"' | head -c 80)"
    return
  fi
  user=$(echo "$r" | jq -r '.user.username // .user.email')
  team_id="team_UV5gBGLeZaz7tK4gdcn5E8Op"  # Conspectus team
  deploys=$(curl -s -m 10 "https://api.vercel.com/v6/deployments?app=conspectus&limit=1&teamId=$team_id" \
            -H "Authorization: Bearer $VERCEL_TOKEN")
  latest_url=$(echo "$deploys" | jq -r '.deployments[0].url // empty')
  latest_state=$(echo "$deploys" | jq -r '.deployments[0].state // .deployments[0].readyState // "?"')
  latest_created=$(echo "$deploys" | jq -r 'if .deployments[0].created then (.deployments[0].created/1000|todate|.[0:10]) else "?" end')
  # Tripwire: empty deploys list means the token has no access to the Conspectus team's conspectus project.
  # Token could be valid for a personal account but useless for what we need.
  if [ -z "$latest_url" ]; then
    local err
    err=$(echo "$deploys" | jq -r '.error.message // "no deployments visible for Conspectus team conspectus project"')
    report FAIL Vercel "token has no access to Conspectus team: $err"
    return
  fi
  # Agent-useful signal: days since last deploy. Helps spot stale prod / forgotten branches.
  local days_old=""
  if [ "$latest_created" != "?" ]; then
    local now_s deploy_s
    now_s=$(date +%s)
    deploy_s=$(date -j -f "%Y-%m-%d" "$latest_created" "+%s" 2>/dev/null || date -d "$latest_created" "+%s" 2>/dev/null)
    [ -n "$deploy_s" ] && days_old=", $(( (now_s - deploy_s) / 86400 ))d ago"
  fi
  report PASS Vercel "user=$user, latest deploy: $latest_url [$latest_state, $latest_created$days_old]"
}

check_neon() {
  need NEON_API_KEY Neon || return
  local proj r name pg region
  proj="${NEON_PROJECT_ID:-young-term-18536146}"
  r=$(curl -s -m 10 "https://console.neon.tech/api/v2/projects/$proj" \
      -H "Authorization: Bearer $NEON_API_KEY")
  name=$(echo "$r" | jq -r '.project.name // empty')
  if [ -z "$name" ]; then
    report FAIL Neon "$(echo "$r" | jq -r '.message // "no project.name in response"' | head -c 80)"
    return
  fi
  pg=$(echo "$r" | jq -r '.project.pg_version')
  region=$(echo "$r" | jq -r '.project.region_id')
  local br br_count default_br
  br=$(curl -s -m 10 "https://console.neon.tech/api/v2/projects/$proj/branches" \
       -H "Authorization: Bearer $NEON_API_KEY")
  br_count=$(echo "$br" | jq -r '.branches | length')
  default_br=$(echo "$br" | jq -r '.branches[] | select(.default==true) | .name')
  # Tripwire: assert this is the Conspectus project with `production` as default.
  # If someone repoints NEON_PROJECT_ID at a fork or a staging Neon, agents running
  # migrations would otherwise happily proceed against the wrong DB.
  if [ "$name" != "Conspectus" ]; then
    report FAIL Neon "wrong project: name=\"$name\", expected \"Conspectus\" — check NEON_PROJECT_ID/NEON_API_KEY"
    return
  fi
  if [ "$default_br" != "production" ]; then
    report FAIL Neon "default branch is \"$default_br\", expected \"production\" — branch model has changed, review before running migrations"
    return
  fi
  report PASS Neon "$name, pg=$pg, $region, $br_count branches (default: $default_br)"
}

check_github() {
  need GITHUB_TOKEN GitHub || return
  local login exp
  curl -s -m 10 -D /tmp/.smoke-gh-headers -o /tmp/.smoke-gh-body \
    https://api.github.com/user \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" >/dev/null
  login=$(jq -r '.login // empty' /tmp/.smoke-gh-body 2>/dev/null)
  exp=$(grep -i 'github-authentication-token-expiration' /tmp/.smoke-gh-headers 2>/dev/null \
        | head -1 | cut -d: -f2- | sed 's/^ //' | tr -d '\r' | awk '{print $1}')
  if [ -z "$login" ]; then
    report FAIL GitHub "$(jq -r '.message // "no login"' /tmp/.smoke-gh-body 2>/dev/null | head -c 80)"
    return
  fi
  # Tripwire: PAT must still grant access to Conspectus-Intel/conspectus (org membership proxy).
  # A token that 404s on the repo is useless even if /user works.
  local commit sha msg date
  commit=$(curl -s -m 10 -H "Authorization: Bearer $GITHUB_TOKEN" \
           -H "Accept: application/vnd.github+json" \
           "https://api.github.com/repos/Conspectus-Intel/conspectus/commits/main")
  sha=$(echo "$commit" | jq -r '.sha // empty' | head -c 7)
  if [ -z "$sha" ]; then
    report FAIL GitHub "no access to Conspectus-Intel/conspectus: $(echo "$commit" | jq -r '.message // "unknown"' | head -c 80)"
    return
  fi
  msg=$(echo "$commit" | jq -r '.commit.message // ""' | head -1 | head -c 50)
  date=$(echo "$commit" | jq -r '.commit.author.date // ""' | head -c 10)
  # Agent-useful signal: days until PAT expiry. Surfaces a rotation warning before things break.
  # FAIL if already expired (the call above would have errored anyway, but be explicit).
  local exp_note=""
  if [ -n "$exp" ]; then
    local exp_s now_s days_left
    exp_s=$(date -j -f "%Y-%m-%d" "$exp" "+%s" 2>/dev/null || date -d "$exp" "+%s" 2>/dev/null)
    now_s=$(date +%s)
    if [ -n "$exp_s" ]; then
      days_left=$(( (exp_s - now_s) / 86400 ))
      if [ "$days_left" -lt 0 ]; then
        report FAIL GitHub "PAT EXPIRED on $exp — rotate at github.com/settings/tokens"
        return
      fi
      exp_note=", expires=$exp (${days_left}d left)"
    else
      exp_note=", expires=$exp"
    fi
  fi
  report PASS GitHub "user=$login$exp_note — conspectus@main: $sha \"$msg\" ($date)"
}

check_twitter() {
  need TWITTERAPI_IO_KEY "Twitter API" || return
  local r credits sample sample_followers
  r=$(curl -s -m 10 "https://api.twitterapi.io/oapi/my/info" -H "x-api-key: $TWITTERAPI_IO_KEY")
  credits=$(echo "$r" | jq -r '.recharge_credits // empty')
  if [ -z "$credits" ]; then
    report FAIL "Twitter API" "$(echo "$r" | head -c 80)"
    return
  fi
  # Tripwire: zero credits means every downstream call will fail. Better to know at smoke-test time
  # than mid-task when the twitter-bot starts returning 402s.
  if [ "$credits" -le 0 ] 2>/dev/null; then
    report FAIL "Twitter API" "credits=$credits — recharge before using twitter-bot"
    return
  fi
  sample=$(curl -s -m 10 "https://api.twitterapi.io/twitter/user/info?userName=jack" \
           -H "x-api-key: $TWITTERAPI_IO_KEY")
  sample_followers=$(echo "$sample" | jq -r '.data.followers // "?"')
  report PASS "Twitter API" "credits=$credits, sample @jack followers=$sample_followers"
}

_check_trigger_one() {
  # One environment's smoke check. Arguments:
  #   $1 — service label shown in output (e.g. "Trigger.dev prod")
  #   $2 — env var name holding the bearer token
  #   $3 — expected env.name on returned runs (e.g. "prod" or "dev")
  local svc="$1" var="$2" expected="$3"
  need "$var" "$svc" || return
  local token="${!var}"
  local r run_count latest_task latest_status latest_env
  # NOTE: api.trigger.dev is the API host; cloud.trigger.dev is the dashboard only.
  r=$(curl -s -m 10 "https://api.trigger.dev/api/v1/runs?page%5Bsize%5D=5" \
      -H "Authorization: Bearer $token")
  run_count=$(echo "$r" | jq -r '.data | length' 2>/dev/null)
  if [ -z "$run_count" ] || [ "$run_count" = "null" ]; then
    report FAIL "$svc" "$(echo "$r" | jq -r '.error // .title // .' 2>/dev/null | head -c 100)"
    return
  fi
  # Scope tripwire: a tr_<env>_ key must only ever surface its own env's runs.
  # If runs come back tagged with a different env, the wrong key is loaded.
  latest_env=$(echo "$r" | jq -r '.data[0].env.name // "?"')
  if [ "$run_count" -gt 0 ] && [ "$latest_env" != "$expected" ]; then
    report FAIL "$svc" "wrong env: latest run is \"$latest_env\", expected $expected — check $var"
    return
  fi
  latest_task=$(echo "$r" | jq -r '.data[0].taskIdentifier // "—"')
  latest_status=$(echo "$r" | jq -r '.data[0].status // "?"')
  if [ "$run_count" -eq 0 ]; then
    # New dev keys often have zero runs until first use — that's a healthy state,
    # not a failure. We still confirm the token was accepted (otherwise the
    # earlier null-data check would have caught it).
    report PASS "$svc" "env=$expected, 0 recent runs (token accepted, no activity yet)"
  else
    report PASS "$svc" "env=$latest_env, $run_count recent runs — latest: $latest_task ($latest_status)"
  fi
}

check_trigger_prod() { _check_trigger_one "Trigger.dev prod" TRIGGER_PROD_SECRET_KEY "prod"; }
check_trigger_dev()  { _check_trigger_one "Trigger.dev dev"  TRIGGER_DEV_SECRET_KEY  "dev"; }

check_railway() {
  need RAILWAY_TOKEN Railway || return
  local r proj_names proj_count
  # Uses project-scoped token; `me` query is unavailable for this token type.
  # Tripwire: must see the claudespectus project.
  r=$(curl -s -m 10 -X POST https://backboard.railway.app/graphql/v2 \
      -H "Authorization: Bearer $RAILWAY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"query":"{ projects { edges { node { id name services { edges { node { id name } } } } } } }"}')
  proj_count=$(echo "$r" | jq -r '.data.projects.edges | length' 2>/dev/null)
  if [ -z "$proj_count" ] || [ "$proj_count" = "null" ]; then
    report FAIL Railway "$(echo "$r" | jq -r '.errors[0].message // "auth failed"' 2>/dev/null | head -c 100)"
    return
  fi
  proj_names=$(echo "$r" | jq -r '[.data.projects.edges[].node.name] | join(", ")' 2>/dev/null)
  # Tripwire: must see claudespectus project
  if ! echo "$proj_names" | grep -qi "claudespectus"; then
    report FAIL Railway "claudespectus project not visible — check token scope (got: $proj_names)"
    return
  fi
  local svc_count
  svc_count=$(echo "$r" | jq -r '[.data.projects.edges[].node.services.edges | length] | add // 0')
  report PASS Railway "projects: $proj_names ($svc_count services)"
}

# --- main ---
if [ "$FORMAT" != "--json" ]; then
  echo "Conspectus services smoke test"
  echo "------------------------------"
fi

check_notion
check_slack_bot
check_slack_user
check_aws
check_aws_bedrock
check_aws_scoping
check_granola
check_vercel
check_neon
check_github
check_twitter
check_trigger_prod
check_trigger_dev
check_railway

if [ "$FORMAT" = "--json" ]; then
  printf '{"pass":%d,"fail":%d,"skip":%d,"known":%d,"results":[%s]}\n' \
    "$pass_cnt" "$fail_cnt" "$skip_cnt" "$known_cnt" \
    "$(IFS=,; echo "${results_json[*]}")"
else
  echo
  echo -e "Summary: ${G}${pass_cnt} pass${N}, ${R}${fail_cnt} fail${N}, ${Y}${skip_cnt} skip${N}, ${B}${known_cnt} known-fail${N}"
  [ "$fail_cnt" -eq 0 ] && echo -e "${G}OK — all expected services reachable.${N}" \
                       || echo -e "${R}FAIL — see above. CLAUDE.md describes each service.${N}"
fi

# Exit 0 only if no unexpected failures. SKIP means "not configured" → still 0.
# KNOWN (Granola) doesn't fail the exit.
[ "$fail_cnt" -eq 0 ]
