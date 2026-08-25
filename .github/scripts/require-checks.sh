#!/usr/bin/env bash
#
# Make the checks on `main` blocking rather than advisory.
#
# Run this once, after `VERCEL_AUTOMATION_BYPASS_SECRET` exists (README.md, Deploying
# step 2). It is idempotent — running it again updates the ruleset in place.
#
#     .github/scripts/require-checks.sh            set the rule up
#     .github/scripts/require-checks.sh --force    ... even without the secret
#
# Why a script you run rather than something already applied: until the bypass secret is
# set, `preview-schema.yml` fails by design, and a required check that cannot pass makes
# `main` unmergeable. So the ordering is secret first, rule second — and this script
# refuses to run in the other order rather than leaving you to discover it.
#
# Why it matters at all is ADR-0016. A check nobody is required to pass is advice, and the
# specific state that ticket cares about is *silence*: if no preview deploys, no
# `deployment_status` fires and "Preview schema" never reports. A required check turns
# that absence into a blocked merge. Without the rule, an absent check is indistinguishable
# from a passing one, which is the whole failure mode.

set -euo pipefail

force=false
[ "${1:-}" = "--force" ] && force=true

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

# The names the rule matches. `verify` is the job in ci.yml; "Preview schema" is the
# STATUS_CONTEXT posted by preview-schema.yml. Renaming either without renaming it here
# converts a blocking check into an absent one — silence again.
ci_check="verify"
preview_check="Preview schema"

secrets=$(gh secret list --repo "$repo" --json name --jq '.[].name')

if ! printf '%s\n' "$secrets" | grep -qx VERCEL_AUTOMATION_BYPASS_SECRET; then
  echo "VERCEL_AUTOMATION_BYPASS_SECRET is not set on ${repo}."
  echo
  echo "Requiring '${preview_check}' before that secret exists makes main unmergeable:"
  echo "the check fails by design when it has no way through Deployment Protection."
  echo
  echo "  1. Vercel -> project -> Settings -> Deployment Protection ->"
  echo "     Protection Bypass for Automation -> generate"
  echo "  2. gh secret set VERCEL_AUTOMATION_BYPASS_SECRET"
  echo "  3. re-run this script"
  echo
  echo "Pass --force to set the rule up anyway."
  $force || exit 1
fi

payload=$(
  jq -n --arg ci "$ci_check" --arg preview "$preview_check" '{
    name: "main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      # Only what #44 asked for: the two status checks, plus the pull_request rule they
      # need in order to apply at all. Deletion and force-push protection would be
      # reasonable and are deliberately not here — they are a different decision.
      #
      # Zero approvals: this is a solo repo, and the point is not review but that changes
      # arrive as pull requests at all — a direct push to main is a merge no check ever
      # saw.
      { type: "pull_request", parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false
      } },
      { type: "required_status_checks", parameters: {
          # Deliberately not strict. "Up to date with main" is about base drift; these
          # two checks are about the shared database and the migrations this branch adds,
          # and a stale base does not make either answer wrong. Strict would add a rebase
          # to every merge to buy nothing.
          strict_required_status_checks_policy: false,
          required_status_checks: [ { context: $ci }, { context: $preview } ]
      } }
    ]
  }'
)

# Same SIGPIPE trap as above: `| head -n1` would abort the script under `pipefail` on a
# repository with more than one ruleset. `first` in jq, so nothing has to be truncated.
existing=$(gh api "repos/${repo}/rulesets" --jq 'first(.[] | select(.name == "main") | .id) // ""')

if [ -n "$existing" ]; then
  echo "Updating ruleset ${existing} on ${repo}."
  printf '%s' "$payload" | gh api --method PUT "repos/${repo}/rulesets/${existing}" --input - >/dev/null
else
  echo "Creating ruleset on ${repo}."
  printf '%s' "$payload" | gh api --method POST "repos/${repo}/rulesets" --input - >/dev/null
fi

echo
echo "main now requires '${ci_check}' and '${preview_check}' to pass, on a pull request."
echo "Confirm it can fail: open a pull request adding a migration without pushing it,"
echo "and watch '${preview_check}' go red rather than absent."
