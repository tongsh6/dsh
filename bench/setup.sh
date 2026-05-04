#!/usr/bin/env bash
# DSH Benchmark Setup — clone/update target projects
set -euo pipefail

BENCH_ROOT="${DSH_BENCH_ROOT:-$HOME/dsh-bench}"
REPOS_DIR="$BENCH_ROOT/repos"

# name repo_url (tab-separated pairs, bash 3.x compatible)
PROJECTS="
loamlog	https://github.com/tongsh6/loamlog.git
pi-proof-forge	https://github.com/tongsh6/pi-proof-forge.git
release-hub	https://github.com/tongsh6/release-hub.git
"

echo "==> DSH Benchmark Setup"
echo "    Bench root: $BENCH_ROOT"
mkdir -p "$REPOS_DIR"

echo "$PROJECTS" | while IFS="	" read -r name url; do
  [ -z "$name" ] && continue
  repo_path="$REPOS_DIR/$name"

  if [ -d "$repo_path/.git" ]; then
    echo ""
    echo "--- $name: pulling latest ---"
    git -C "$repo_path" fetch origin
    git -C "$repo_path" checkout main 2>/dev/null || git -C "$repo_path" checkout master 2>/dev/null || true
    git -C "$repo_path" reset --hard origin/HEAD
  else
    echo ""
    echo "--- $name: cloning ---"
    git clone "$url" "$repo_path"
  fi
done

echo ""
echo "==> Setup complete. Target projects at $REPOS_DIR"
echo "    Next: pnpm exec tsx run-benchmark.ts"
