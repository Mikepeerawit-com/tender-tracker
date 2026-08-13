#!/usr/bin/env bash
#
# Ticket 14 (#15): does mentioned_list (userid) bind, and does WeCom validate it?
#
# Ticket 06 measured the mobile route and found its landmine: a wrongly formatted
# number returns errcode 0 and silently never notifies. This asks the same question
# of the userid route. If a bogus userid returns a NON-ZERO errcode, the userid
# route has a runtime signal the mobile route lacks — which is the whole argument
# for preferring it.
#
# Phase 1 (no userid needed): bogus identifiers only. Nobody is mentioned, so
# nobody is notified — this reads the API's response, not the group.
# Phase 2 (needs USERID=...): the real userid. The group is the oracle.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
[[ -f "$ENV_FILE" ]] || { echo "no .env at $ENV_FILE" >&2; exit 1; }
WEBHOOK=$(grep '^WECOM_ROBOT_WEBHOOK=' "$ENV_FILE" | cut -d= -f2-)
[[ -n "$WEBHOOK" ]] || { echo "WECOM_ROBOT_WEBHOOK not in .env" >&2; exit 1; }

send() {  # send LABEL MENTIONED_LIST_JSON
  local body
  body=$(jq -nc --arg c "[14-userid $1] $3" --argjson m "$2" \
              '{msgtype:"text",text:{content:$c,mentioned_list:$m}}')
  printf '  %-5s %-34s → %s\n' "$1" "$2" \
    "$(curl -sS -X POST -H 'Content-Type: application/json' -d "$body" "$WEBHOOK" \
       | jq -c '{errcode,errmsg}')"
  sleep 3   # ~17/min, under the documented 20/min cap
}

echo "Phase 1 — bogus userids. Does WeCom validate, or silently accept?"
send "BOGUS" '["zzz_no_such_user_zzz"]' "well-formed but nonexistent userid — nobody should be mentioned"
send "EMPTY" '[""]'                     "empty-string userid — malformed"

if [[ -n "${USERID:-}" ]]; then
  echo
  echo "Phase 2 — your real userid. Watch your phone."
  send "REAL" "$(jq -nc --arg u "$USERID" '[$u]')" "if this notifies you, mentioned_list works and users.mobile may be unnecessary"
else
  echo
  echo "Phase 2 skipped — rerun with USERID=<your Account from Contacts> $0"
fi
