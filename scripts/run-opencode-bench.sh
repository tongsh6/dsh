#!/bin/bash
# OpenCode 对比 benchmark runner.
# 逐 fixture 跑 OpenCode + 验证 + git reset.
# 用法: bash scripts/run-opencode-bench.sh [--filter=prefix]

set -euo pipefail

FILTER=""
for arg in "$@"; do
  if [[ "$arg" == --filter=* ]]; then
    FILTER="${arg#--filter=}"
  fi
done

FIXTURES_DIR="packages/eval/src/fixtures"
REPORTS_DIR="docs/reports"
RUN_ID="oc-$(date +%s)"
RESULTS_FILE="/tmp/oc-bench-${RUN_ID}.json"
BENCH_ROOT="$HOME/dsh-bench/repos"

echo "[OC-BENCH] run_id=$RUN_ID starting"
echo "[OC-BENCH] filter=$FILTER"
echo ""

declare -A REPO_MAP
REPO_MAP["pi-"]="$BENCH_ROOT/pi-proof-forge"
REPO_MAP["loam-"]="$BENCH_ROOT/loamlog"
REPO_MAP["rh-"]="$BENCH_ROOT/release-hub"

RESULTS="["

FIRST=true
for yaml_file in "$FIXTURES_DIR"/*.yaml; do
  id=$(grep -m1 "^id:" "$yaml_file" | sed 's/^id: *//')
  category=$(grep -m1 "^category:" "$yaml_file" | sed 's/^category: *//')
  [[ -z "$id" ]] && continue
  [[ "$id" =~ ^(task-|hallucinated|overconfidence|patch-drift|rule-blindness|scope-creep) ]] && continue
  [[ -n "$FILTER" && "$id" != "$FILTER"* ]] && continue

  repo=""
  for prefix in "${!REPO_MAP[@]}"; do
    if [[ "$id" == "$prefix"* ]]; then repo="${REPO_MAP[$prefix]}"; break; fi
  done
  [[ -z "$repo" ]] && { echo "SKIP $id (no repo)"; continue; }

  # Read taskPrompt
  task_prompt=$(python3 -c "
import yaml
with open('$yaml_file') as f:
    d = yaml.safe_load(f)
print(d['taskPrompt'], end='')
")

  # Read verification commands
  IFS=$'\n' read -d '' -ra ver_cmds < <(python3 -c "
import yaml
with open('$yaml_file') as f:
    d = yaml.safe_load(f)
cmds = d.get('verificationCommands', [])
for c in cmds:
    print(c)
" 2>/dev/null || true)

  echo "=== $id ($category) ==="
  START=$(date +%s%N)

  # Git setup
  (cd "$repo" && git checkout main -q && git branch -D "oc-bench-$id" 2>/dev/null || true && git checkout -b "oc-bench-$id" -q)

  # Run OpenCode
  COMPLETED=false
  ERROR=""
  TMPFILE=$(mktemp)
  echo "$task_prompt" > "$TMPFILE"
  if opencode run -m deepseek/deepseek-v4-pro --variant high --print-logs "$(cat "$TMPFILE")" 2>&1; then
    COMPLETED=true
  else
    ERROR="opencode failed"
  fi
  rm -f "$TMPFILE"

  # Detect changed files
  CHANGED="[]"
  if git -C "$repo" diff --name-only HEAD 2>/dev/null | grep -q .; then
    CHANGED_ARR=$(git -C "$repo" diff --name-only HEAD | sed 's/.*/"&"/' | paste -sd,)
    CHANGED="[$CHANGED_ARR]"
  fi

  # Verify
  TESTS_PASSED=false
  if $COMPLETED && [[ ${#ver_cmds[@]} -gt 0 ]]; then
    ALL_PASS=true
    for cmd in "${ver_cmds[@]}"; do
      (cd "$repo" && eval "$cmd" &>/dev/null) || { ALL_PASS=false; break; }
    done
    $ALL_PASS && TESTS_PASSED=true
  fi

  END=$(date +%s%N)
  DURATION_MS=$(( (END - START) / 1000000 ))

  echo "  -> $([ "$TESTS_PASSED" = true ] && echo PASS || $COMPLETED && echo FAIL || echo ERROR) ($((DURATION_MS / 1000))s)"

  # Cleanup
  (cd "$repo" && git reset --hard -q && git checkout main -q && git branch -D "oc-bench-$id" 2>/dev/null || true)

  # Append JSON
  ENTRY=$(cat <<JSON
  {
    "fixtureId": "$id",
    "category": "$category",
    "completed": $COMPLETED,
    "testsPassed": $TESTS_PASSED,
    "filesChanged": $CHANGED,
    "durationMs": $DURATION_MS,
    "error": "$ERROR"
  }
JSON
  )
  $FIRST && RESULTS+="$ENTRY" || RESULTS+=",$ENTRY"
  FIRST=false
done

RESULTS+="]"
echo "$RESULTS" > "$RESULTS_FILE"

# Save to reports dir
mkdir -p "$REPORTS_DIR/$RUN_ID"
cp "$RESULTS_FILE" "$REPORTS_DIR/$RUN_ID/results.json"
echo "[OC-BENCH] done -> $REPORTS_DIR/$RUN_ID"
