#!/usr/bin/env bash
# Copy docs/ to the public demo repository and turn on Pages from the
# repository root. This script does not create that repository.
set -euo pipefail

dest_repo="${DEST_REPO:-saltylvn/benchmark-demo}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! gh repo view "$dest_repo" >/dev/null 2>&1; then
  echo "Cannot see ${dest_repo}. This script does not create it." >&2
  exit 1
fi

gh repo clone "$dest_repo" "$work/site" -- --branch main
rsync -a --delete --exclude '.git' "$root/docs/" "$work/site/"

cat > "$work/site/README.md" << 'EOF'
# Benchmark

Benchmark is a team of agents for a construction project manager. This site is the mock demo for one fictional Thursday. Maria Alvarez approves every draft. Nothing is sent.

Open `index.html` to play the day.
EOF

cd "$work/site"
git add -A
if git diff --cached --quiet; then
  echo "docs/ already matches ${dest_repo}."
else
  git -c user.email="noreply@users.noreply.github.com" -c user.name="Benchmark publish" commit -m "Publish the Benchmark demo."
  git push origin main
fi

if gh api --method POST "repos/${dest_repo}/pages" \
  -f "build_type=legacy" \
  -f "source[branch]=main" \
  -f "source[path]=/" >/dev/null 2>&1; then
  echo "Pages is enabled from the main branch root."
else
  gh api --method PUT "repos/${dest_repo}/pages" \
    -f "build_type=legacy" \
    -f "source[branch]=main" \
    -f "source[path]=/" >/dev/null
  echo "Pages source set to the main branch root."
fi
