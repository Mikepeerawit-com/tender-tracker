#!/usr/bin/env bash
#
# Ask a deployment whether the database it talks to holds the migrations it was built
# against, and name the fault if it does not.
#
# Two workflows call this, and the only things that differ between them are *which URL
# is asked* and *what a redirect means* there:
#
#   deployment-health.yml   production, the public alias, no credential.
#                           A redirect means Deployment Protection got switched on over
#                           something that is public by design.
#   preview-schema.yml      the pull request's preview, its own deployment URL, bypass
#                           secret. A redirect means the secret is missing or stale.
#
# Everything after the response arrives is the same sentence in both, which is why this
# is one file. Two copies would drift, and the copy that drifts is the one that quietly
# stops being able to fail — see docs/adr/0016-a-check-must-be-able-to-fail.md.
#
# Inputs, all environment:
#   HEALTH_ORIGIN                    required. Origin to ask; `/api/health` is appended.
#   PROBE_TARGET                     required. `production` or `preview`.
#   VERCEL_AUTOMATION_BYPASS_SECRET  required when PROBE_TARGET=preview.
#   GITHUB_OUTPUT                    optional. Gets a one-line `summary=` for the
#                                    commit status description.
#   PROBE_RETRY_DELAY                optional, default 5 (seconds). Exists so the
#                                    connection-refused branch is reachable in a test.

set -uo pipefail

: "${HEALTH_ORIGIN:?HEALTH_ORIGIN is required}"
: "${PROBE_TARGET:?PROBE_TARGET is required}"

max_attempts=3
retry_delay="${PROBE_RETRY_DELAY:-5}"

url="${HEALTH_ORIGIN%/}/api/health"

# GitHub truncates a commit status description at 140 characters, and every sentence
# below puts the version numbers at the end — so the summary is written short rather
# than written long and cut. The cut is a backstop against a future edit forgetting.
write_summary() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'summary=%s\n' "$(printf '%s' "$1" | tr -d '\n' | cut -c1-140)" >>"$GITHUB_OUTPUT"
  fi
}

pass() {
  echo "::notice::$1"
  write_summary "$1"
  exit 0
}

# `$1` is the summary — short, and the whole of what a reader sees on the pull request's
# check line. `$2` is everything that would not fit there.
fail() {
  echo "::error::$1${2:+ }${2:-}"
  write_summary "$1"
  exit 1
}

# One array, never empty. Under `set -u`, bash 3.2 — which is what macOS ships and so
# what this gets run under locally — treats `"${empty[@]}"` as an unbound variable and
# aborts. The runners have bash 5 and would not have shown it.
curl_args=(-sS --max-time 30 -w '\n%{http_code}')

case "$PROBE_TARGET" in
  production)
    label="Production"
    redirect_summary="Deployment Protection appears to be on."
    redirect_detail="Production is public by design — that is what lets this probe run without a credential — so a redirect to SSO here makes the check uncheckable and is a fault in its own right."
    ;;
  preview)
    label="This preview"
    redirect_summary="VERCEL_AUTOMATION_BYPASS_SECRET is not getting past Deployment Protection."
    redirect_detail="The secret is set but wrong, rotated, or from a different Vercel project. Regenerate Protection Bypass for Automation on the project and update the repository secret."

    # Not a skip. A missing secret is the state this check is most likely to be in on the
    # day it is added, and "we could not look, so it is probably fine" is the exact shape
    # ADR-0016 refuses. Named, so the fix is the message.
    if [ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]; then
      fail "No VERCEL_AUTOMATION_BYPASS_SECRET, so the preview cannot be asked anything." \
        "Previews sit behind Deployment Protection. Generate Protection Bypass for Automation on the Vercel project (Settings → Deployment Protection) and add it to this repository as the Actions secret VERCEL_AUTOMATION_BYPASS_SECRET. See README.md, Deploying step 2, under \"Previews sit behind Deployment Protection\"."
    fi

    curl_args+=(-H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
    ;;
  *)
    fail "PROBE_TARGET must be 'production' or 'preview', not '${PROBE_TARGET}'."
    ;;
esac

echo "Probing ${url}"

# Deliberately not `curl --retry`. That retries transient *HTTP* errors, 503 among them —
# and 503 is this endpoint's considered answer about a real fault, not a blip. Retrying it
# appends each body to the last, and every `jq` below then reads three documents and
# prints three values into one sentence. Retry only what is genuinely transient: a
# connection that never opened.
attempt=1
while true; do
  response=$(curl "${curl_args[@]}" "$url" 2>&1) && break

  if [ "$attempt" -ge "$max_attempts" ]; then
    fail "${label} did not answer at all after ${attempt} attempts." \
      "The deployment itself is unreachable, which is a different fault from the app reporting its database unreachable. curl said: ${response}"
  fi

  attempt=$((attempt + 1))
  sleep "$retry_delay"
done

code=$(printf '%s' "$response" | tail -n1)
body=$(printf '%s' "$response" | sed '$d')

# A redirect is a fault, in both directions, and never an absence of information to step
# around. It means opposite things here — protection switched on where it should be off,
# or a bypass secret that is not working where protection is expected — but the same
# thing has to happen: red.
case "$code" in
  301 | 302 | 303 | 307 | 308 | 401 | 403)
    fail "${label} answered ${code} rather than its status: ${redirect_summary}" \
      "${redirect_detail} ${url}"
    ;;
esac

echo "$body" | jq . || echo "$body"

status=$(printf '%s' "$body" | jq -r '.status // "unparseable"')
applied=$(printf '%s' "$body" | jq -r '.schema.applied // "null"')

if [ "$code" = "200" ] && [ "$status" = "ok" ]; then
  pass "${label} is level with its build, at migration ${applied}."
fi

# Name the fault rather than the failure. Which of these fired decides who fixes it and
# how — see the status table in README.md.
expected=$(printf '%s' "$body" | jq -r '.schema.expected // "unknown"')
behind=$(printf '%s' "$body" | jq -r '.schema.behind // "null"')
# `tostring`, not `// "unknown"`: jq's alternative operator treats `false` as absent, so
# `.tables.readable // "unknown"` reports "unknown" for exactly the one value this branch
# exists to catch.
readable=$(printf '%s' "$body" | jq -r '.tables.readable | tostring')
database=$(printf '%s' "$body" | jq -r '.database // "unknown"')

if [ "$status" = "misconfigured" ]; then
  fail "${label} has no usable Supabase credentials." \
    "See README.md, Deploying step 1 — and remember env vars added after a build need a redeploy."
fi

if [ "$database" = "unreachable" ]; then
  fail "${label} cannot reach its database at all." \
    "Check the Supabase project is not paused."
fi

if [ "$applied" = "null" ]; then
  fail "${label} runs against a database no migration ever reached; it expects ${expected}." \
    "Run \`supabase db push\` — README.md, Deploying step 2."
fi

if [ "$behind" != "0" ] && [ "$behind" != "null" ]; then
  fail "${label} is missing ${behind} of its migration(s): expects ${expected}, database holds ${applied}." \
    "They need not be the newest ones: \`behind\` counts every expected version the database does not hold, including a gap in the middle. Run \`supabase db push\`."
fi

if [ "$readable" = "false" ]; then
  error=$(printf '%s' "$body" | jq -r '.tables.error // "unknown"')
  fail "${label} has its schema and cannot read it (${error}): its table grants are missing." \
    "This needs a migration granting them, as 20260825010000 did."
fi

fail "${label} answered ${code} with status '${status}'." "${url}"
