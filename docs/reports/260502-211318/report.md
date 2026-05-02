# DSH Evaluation Report

## Overview

| Metric | Value |
|--------|-------|
| Task completion rate | 2/8 (25%) |
| Average score | 39.8 |
| Repair success rate | 0/N/A |
| Avg repair rounds | 0.0 |
| Avg manual interventions | 0.0 |

## Protocol Operation Coverage

| Operation | Expected (fixtures) | Actual (triggered) | Success Rate |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 0 | N/A |
| PATCH | 7 | 0 | N/A |
| SEARCH_REPLACE | 1 | 0 | N/A |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |

## Per-Task Detail

### dsh-bugfix-scanner-ts (bugfix) — Score: 20/100

| Dimension | Result |
|-----------|--------|
| Completed | ✗ |
| Files modified | (none) |
| Expected files | packages/repo/src/scanner.ts, packages/repo/src/scanner.test.ts |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 0/3 |
| Duration | 0.1s |
| Error | git branch -D dsh-bench-dsh-bugfix-scanner-ts failed in /Users/loong/workspace/code/github/ai/dsh: Command failed: git branch -D dsh-bench-dsh-bugfix-scanner-ts |

### dsh-refactor-config (refactor) — Score: 20/100

| Dimension | Result |
|-----------|--------|
| Completed | ✗ |
| Files modified | (none) |
| Expected files | packages/repo/src/config-loader.ts, packages/cli/src/utils/config.ts, packages/core/src/pipeline.ts |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 0/3 |
| Duration | 0.1s |
| Error | git branch -D dsh-bench-dsh-refactor-config failed in /Users/loong/workspace/code/github/ai/dsh: Command failed: git branch -D dsh-bench-dsh-refactor-config |

### dsh-test-scanner (test) — Score: 20/100

| Dimension | Result |
|-----------|--------|
| Completed | ✗ |
| Files modified | (none) |
| Expected files | packages/repo/src/scanner.test.ts |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 0/3 |
| Duration | 0.1s |
| Error | git branch -D dsh-bench-dsh-test-scanner failed in /Users/loong/workspace/code/github/ai/dsh: Command failed: git branch -D dsh-bench-dsh-test-scanner |

### pi-bugfix-count-defs (bugfix) — Score: 20/100

| Dimension | Result |
|-----------|--------|
| Completed | ✗ |
| Files modified | (none) |
| Expected files | tools/check_v2_constraints.py |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 0/3 |
| Duration | 0.1s |
| Error | git branch -D dsh-bench-pi-bugfix-count-defs failed in /tmp/pi-proof-forge: Command failed: git branch -D dsh-bench-pi-bugfix-count-defs |

### pi-docs-check-tools (docs) — Score: 99/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | tools/README.md |
| Expected files | tools/README.md |
| Scope violation | ✓ |
| Tests passed | ✓ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 75.6s |

### pi-refactor-read-text (refactor) — Score: 99/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | tools/extract_evidence.py, tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/extract_evidence_llm.py |
| Expected files | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| Scope violation | ✓ |
| Tests passed | ✓ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 75.8s |

### pi-test-aief-l3 (test) — Score: 20/100

| Dimension | Result |
|-----------|--------|
| Completed | ✗ |
| Files modified | (none) |
| Expected files | tests/unit/domain/test_check_aief_l3.py |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 0/3 |
| Duration | 1154.2s |
| Error | Network error: fetch failed |

### pi-test-error-handler (test) — Score: 20/100

| Dimension | Result |
|-----------|--------|
| Completed | ✗ |
| Files modified | (none) |
| Expected files | tests/unit/domain/test_error_handler.py |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 0/3 |
| Duration | 8.4s |
| Error | Network error: fetch failed |

## Failure Analysis

- **dsh-bugfix-scanner-ts**: task incomplete; repair exhausted
- **dsh-refactor-config**: task incomplete; repair exhausted
- **dsh-test-scanner**: task incomplete; repair exhausted
- **pi-bugfix-count-defs**: task incomplete; repair exhausted
- **pi-test-aief-l3**: task incomplete; repair exhausted
- **pi-test-error-handler**: task incomplete; repair exhausted
