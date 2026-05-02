# DSH Evaluation Report

## Overview

| Metric | Value |
|--------|-------|
| Task completion rate | 7/8 (88%) |
| Average score | 77.3 |
| Repair success rate | 0/2 |
| Avg repair rounds | 2.0 |
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

### dsh-bugfix-scanner-ts (bugfix) — Score: 74/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | packages/repo/src/scanner.ts, packages/repo/src/scanner.test.ts |
| Expected files | packages/repo/src/scanner.ts, packages/repo/src/scanner.test.ts |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 884.5s |
| Error | repair failed: Request timed out |

### dsh-refactor-config (refactor) — Score: 99/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | packages/repo/src/config-loader.ts, packages/cli/src/utils/config.ts, packages/core/src/pipeline.ts |
| Expected files | packages/repo/src/config-loader.ts, packages/cli/src/utils/config.ts, packages/core/src/pipeline.ts |
| Scope violation | ✓ |
| Tests passed | ✓ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 343.0s |

### dsh-test-scanner (test) — Score: 64/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | packages/repo/src/scanner.test.ts, packages/repo/src/scanner.test.ts |
| Expected files | packages/repo/src/scanner.test.ts |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 2 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 660.6s |

### pi-bugfix-count-defs (bugfix) — Score: 64/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | tools/check_v2_constraints.py, tools/check_v2_constraints.py |
| Expected files | tools/check_v2_constraints.py |
| Scope violation | ✓ |
| Tests passed | ✗ |
| Repair rounds | 2 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 264.3s |

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
| Duration | 93.4s |

### pi-refactor-read-text (refactor) — Score: 99/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | tools/extract_evidence.py, tools/extract_evidence.py, tools/extract_evidence_llm.py |
| Expected files | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| Scope violation | ✓ |
| Tests passed | ✓ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 182.7s |

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
| Duration | 315.8s |
| Error | 变更应用失败 — CREATE rejected: tests/unit/domain/test_check_aief_l3.py already exists. Use <PATCH> or <PATCH type="search"> to modify existing files. |

### pi-test-error-handler (test) — Score: 99/100

| Dimension | Result |
|-----------|--------|
| Completed | ✓ |
| Files modified | tests/unit/domain/test_error_handler.py |
| Expected files | tests/unit/domain/test_error_handler.py |
| Scope violation | ✓ |
| Tests passed | ✓ |
| Repair rounds | 0 |
| Repair success | ✗ |
| Rule violations | 0 |
| Handoff quality | 2/3 |
| Duration | 79.9s |

## Failure Analysis

- **dsh-bugfix-scanner-ts**: repair exhausted
- **dsh-test-scanner**: repair exhausted
- **pi-bugfix-count-defs**: repair exhausted
- **pi-test-aief-l3**: task incomplete; repair exhausted
