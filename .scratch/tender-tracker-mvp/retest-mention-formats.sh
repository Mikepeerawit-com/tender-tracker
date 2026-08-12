#!/usr/bin/env bash
#
# Ticket 06, still-open item 1: does mentioned_mobile_list actually notify?
#
# WeCom returns errcode 0 whether or not a number matches a group member, so the
# API tells you nothing — the group is the only oracle. This sends one labelled
# message per number format, plus an @all control, and you read your phone.
#
# The @all control is the important one: if @all notifies and no number does,
# the mention MECHANISM works and the problem is purely number matching. If even
# @all fails to notify, ticket 08 must be reopened.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
[[ -f "$ENV_FILE" ]] || { echo "no .env at $ENV_FILE" >&2; exit 1; }
WEBHOOK=$(grep '^WECOM_ROBOT_WEBHOOK=' "$ENV_FILE" | cut -d= -f2-)
[[ -n "$WEBHOOK" ]] || { echo "WECOM_ROBOT_WEBHOOK not in .env" >&2; exit 1; }

# Local number without the leading 0. Override: LOCAL=812345678 ./retest-…
LOCAL="${LOCAL:-933555055}"

send() {  # send LABEL MENTION
  local body
  body=$(jq -nc --arg c "[06-retest $1] if this notifies you, format $1 is correct" \
                --arg m "$2" \
                '{msgtype:"text",text:{content:$c,mentioned_mobile_list:[$m]}}')
  printf '  %-4s %-16s → %s\n' "$1" "$2" \
    "$(curl -sS -X POST -H 'Content-Type: application/json' -d "$body" "$WEBHOOK" | jq -c '{errcode}')"
  sleep 1   # stay well under 20/min
}

echo "Sending 5 messages to the robot's group:"
send "A"  "66$LOCAL"
send "B"  "0$LOCAL"
send "C"  "+66$LOCAL"
send "D"  "$LOCAL"
send "CTL" "@all"

cat <<'EOF'

Now look at your phone. errcode 0 above means "accepted", NOT "mentioned".

  Some letter notified you  → that format is correct. Record it in
                              research/06-wecom-console.md §2 and close item 1.
                              ticket 08's design stands.
  Only CTL notified you     → the mechanism works, but no format matched your
                              contact record. Check Contacts → your member →
                              Mobile in the admin console and try that exact
                              string. Still recoverable.
  Nothing notified you      → REOPEN TICKET 08. Targeted reminders, the
                              nag-only-Assignees-who-haven't-quoted rule, and
                              per-Assignee outcome notifications all collapse
                              back to broadcast.
EOF
