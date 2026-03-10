#!/usr/bin/env bash
set -euo pipefail

# Creates the autorelease labels used by the release workflow.
# Run once per repo:  ./scripts/setup-labels.sh
#
# Requires: gh (GitHub CLI), authenticated with repo access.

REPO="${1:-}"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
fi

create_or_update() {
  local name="$1" color="$2" description="$3"
  if gh label view "$name" --repo "$REPO" >/dev/null 2>&1; then
    echo "Label '$name' already exists — updating"
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$description"
  else
    echo "Creating label '$name'"
    gh label create "$name" --repo "$REPO" --color "$color" --description "$description"
  fi
}

create_or_update "autorelease: pending" "FBCA04" "Release PR awaiting merge"
create_or_update "autorelease: tagged"  "0E8A16" "Release PR has been tagged and published"

echo "Done."
