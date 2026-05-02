# DSH vs OpenCode Baseline Comparison Report

> **Generated:** 2026-05-02
> **Method:** Same fixtures, same DeepSeek model (deepseek-v4-pro), same repo state (pi-proof-forge@d01d427). DSH uses structured pipeline (plan→patch→verify→repair). OpenCode uses `opencode run --model deepseek/deepseek-v4-pro`.
> **Caveat:** Small sample (4 completed fixtures). Statistical significance requires 10+ fixtures.

## Summary

| Metric | DSH | OpenCode |
|--------|-----|----------|
| Fixtures attempted | 5 | 5 |
| Completed | 5 | 4 (1 stuck) |
| Tests passed | 3 | 4 |
| Pass rate (completed) | 60% (3/5) | 100% (4/4) |
| Self-correction needed | 1 | 1 |
| Self-correction success | 0/1 | 1/1 |

## Per-Fixture Detail

### 1. pi-bugfix-count-defs (bugfix — regex fix in `count_definitions()`)

| | DSH | OpenCode |
|------|-----|----------|
| **Result** | ❌ FAIL | ✅ PASS |
| **First attempt** | Modified function signature incorrectly (changed `(files: list[Path], signature: str)` → `(text: str, signature: str)`), added dead code | Regex double-prefix bug: `^def def post_json\(` (callers already pass `def xxx(` as signature) |
| **Self-correction** | 2 repair rounds, neither fixed the root cause. Repair made things worse (added more dead code, syntax issues) | 1 round. Read test output → analyzed failure → found root cause (callers pass `def post_json(` so regex shouldn't add another `def`) → fixed to `^\s*` + `re.escape(signature)` |
| **Key insight** | Repair hints lacked context about caller conventions. AI couldn't infer that `signature` already includes `def xxx(` prefix | OpenCode read test output, grepped actual call sites, understood the semantic mismatch |

### 2. pi-test-error-handler (test — add PolicyError + FabricationGuardError tests)

| | DSH | OpenCode |
|------|-----|----------|
| **Result** | ✅ PASS (historical data) | ✅ PASS |
| **Approach** | — | Read exceptions.py + handler.py → understood error routing → added 2 test methods |

### 3. pi-refactor-read-text (refactor — extract shared `read_text()`)

| | DSH | OpenCode |
|------|-----|----------|
| **Result** | ✅ PASS (historical data) | ✅ PASS |
| **Approach** | — | Created `tools/infra/file_io.py`, updated both callers' imports |

### 4. pi-test-aief-l3 (test — create tests for `check_aief_l3.py`)

| | DSH | OpenCode |
|------|-----|----------|
| **Result** | ✅ PASS (historical data) | ✅ PASS |
| **Tests created** | — | 16 tests (check_exists ×3, check_contains ×5, check_min_files ×8) |

### 5. pi-docs-check-tools (docs — README usage instructions)

| | DSH | OpenCode |
|------|-----|----------|
| **Result** | ❌ FAIL (historical data) | ❌ STUCK (process hung, needs investigation) |
| **Note** | Patch format issues in historical run | Likely ambiguous verification causing model to loop |

## Key Findings

### Finding 1: Self-correction quality gap

Both tools got the bugfix fixture wrong on first attempt. But OpenCode's iterative debugging was qualitatively different:

- **DSH repair loop**: Applied fix → ran test → test failed → re-applied fix with unclear strategy → failed again. The repair hints ("make smallest possible change") didn't guide the model toward root cause analysis.
- **OpenCode**: Read test output → `grep`ped actual call sites → realized "the caller already passes `def post_json(` so my regex is wrong" → corrected the regex semantics.

This suggests DSH's repair loop would benefit from **injecting call-site context** into repair prompts — not just "test failed" but "here's how this function is called, your change might have broken the interface."

### Finding 2: Structured pipeline helped on simple tasks

For the test and refactor fixtures, DSH's structured approach (plan→patch→verify) worked well — the tasks were straightforward and the plan provided clear direction.

### Finding 3: Both tools struggle with ambiguous docs tasks

pi-docs-check-tools failed on both — docs tasks with vague verification criteria remain hard for AI tools.

## Recommendations

### For DSH (immediate)

1. **Improve repair hints**: Include call-site context (how is the modified function called?) in repair prompts
2. **Detect interface changes**: When a patch changes function signatures, flag it as high-risk and include caller code in the repair context
3. **Repair termination**: If repair makes things strictly worse (more syntax errors), stop earlier

### For benchmark methodology (next iteration)

1. Expand to 10+ fixtures for statistical significance
2. Run DSH with current code on ALL fixtures (not mix of current + historical data)
3. Include Claude Code + DeepSeek as second baseline
4. Measure: first-pass rate, repair success rate, repair round efficiency, token cost

## Raw Data

| Fixture | Category | DSH Pass | OC Pass | DSH Repair Rounds | OC Self-Corrections |
|---------|----------|----------|---------|-------------------|---------------------|
| pi-bugfix-count-defs | bugfix | ❌ | ✅ | 2 (failed) | 1 (succeeded) |
| pi-test-error-handler | test | ✅ | ✅ | 0 | 0 |
| pi-refactor-read-text | refactor | ✅ | ✅ | 0 | 0 |
| pi-test-aief-l3 | test | ✅ | ✅ | 0 | 0 |
| pi-docs-check-tools | docs | ❌ | ❌ (stuck) | 2 (failed) | N/A |
