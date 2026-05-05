import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkTrackedItems } from "./check-tracked-items.js";

function setupFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-tracked-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
  return root;
}

const LEDGER_HEADER = `# Test Ledger

## 8. 长期跟踪事项

| type | id | source | title | trigger | prio | status | last_reviewed |
|------|----|--------|-------|---------|------|--------|---------------|`;

describe("checkTrackedItems", () => {
  it("happy path: spec entries match ledger, no errors", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
| deferred | foo | spec:docs/specs/2026-05-05-test.md | Foo title | when X happens | P2 | waiting | 2026-05-05 |
`,
      "docs/specs/2026-05-05-test.md": `# Test spec

## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred | foo | when X happens | P2 | — |
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.equal(r.warnings.length, 0);
    assert.equal(r.stats.specRows, 1);
    assert.equal(r.stats.ledgerRows, 1);
  });

  it("error: spec entry not registered in ledger", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
`,
      "docs/specs/2026-05-05-test.md": `# Test spec

## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred | orphan-id | when something | P2 | — |
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.ok(r.errors.length >= 1);
    assert.ok(
      r.errors.some(
        (e) =>
          e.kind === "missing-in-ledger" &&
          (e.details as { id: string } | undefined)?.id === "orphan-id",
      ),
      `expected missing-in-ledger error for orphan-id; got: ${JSON.stringify(r.errors)}`,
    );
  });

  it("error: ledger source path does not exist", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
| deferred | foo | spec:docs/specs/does-not-exist.md | Foo | when X | P2 | waiting | 2026-05-05 |
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.ok(
      r.errors.some((e) => e.kind === "source-path-missing"),
      `expected source-path-missing; got: ${JSON.stringify(r.errors)}`,
    );
  });

  it("error: ledger column count wrong (7 instead of 8)", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `# Test
## 8. 长期跟踪事项

| type | id | source | title | trigger | prio | status |
|------|----|--------|-------|---------|------|--------|
| deferred | foo | spec:x.md | Foo | when X | P2 | waiting |
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.ok(
      r.errors.some((e) => e.kind === "ledger-column-count"),
      `expected ledger-column-count; got: ${JSON.stringify(r.errors)}`,
    );
  });

  it("warn (no error): stale last_reviewed > 90 days", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
| deferred | foo | spec:docs/specs/2026-05-05-x.md | Foo | when X | P2 | waiting | 2025-01-01 |
`,
      "docs/specs/2026-05-05-x.md": `# X
## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority |
|------|----|---------|----------|
| deferred | foo | when X | P2 |
`,
    });
    const r = checkTrackedItems({
      rootDir: root,
      now: new Date("2026-05-05"),
      maxStaleDays: 90,
    });
    assert.equal(r.errors.length, 0, `expected no errors; got: ${JSON.stringify(r.errors)}`);
    assert.ok(
      r.warnings.some((w) => w.kind === "stale-review"),
      `expected stale-review warn; got: ${JSON.stringify(r.warnings)}`,
    );
  });

  it("skip: historical spec (date < 2026-05-05) is not scanned", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
`,
      "docs/specs/2026-04-29-old.md": `# Old
## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority |
|------|----|---------|----------|
| deferred | should-be-skipped | never | P3 |
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.equal(r.stats.specRows, 0, "historical spec rows must not be scanned");
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.deepEqual(r.stats.skippedHistoricalSpecs, ["2026-04-29-old.md"]);
  });

  it("error: invalid type/status/priority/date enums in ledger", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
| BOGUS | foo | spec:docs/specs/2026-05-05-x.md | Foo | when | XX | unknown | not-a-date |
`,
      "docs/specs/2026-05-05-x.md": `# X
## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority |
|------|----|---------|----------|
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    const kinds = r.errors.map((e) => e.kind);
    assert.ok(kinds.includes("ledger-invalid-type"), JSON.stringify(kinds));
    assert.ok(kinds.includes("ledger-invalid-status"), JSON.stringify(kinds));
    assert.ok(kinds.includes("ledger-invalid-priority"), JSON.stringify(kinds));
    assert.ok(kinds.includes("ledger-invalid-date"), JSON.stringify(kinds));
  });

  it("blockquote example rows in spec are ignored", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
`,
      "docs/specs/2026-05-05-x.md": `# X
## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|

> 示例（提交前删除）：
>
> | deferred | example-id | when | P3 | — |
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.equal(r.stats.specRows, 0, "blockquote example rows should be skipped");
    assert.equal(r.errors.length, 0);
  });

  it("fenced code block content (markdown examples) is ignored", () => {
    const root = setupFixture({
      "docs/project-ledger.md": `${LEDGER_HEADER}
`,
      "docs/specs/2026-05-05-meta.md": `# Meta spec

## 3.6 spec template example

Example of what other specs should contain:

\`\`\`markdown
## §X 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|---------|-------|
| deferred | example-from-fence | should-not-be-detected | P3 | inside fence |
\`\`\`

## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
`,
    });
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.equal(r.stats.specRows, 0, `fence content must be ignored; got rows: ${r.stats.specRows}`);
    assert.equal(r.errors.length, 0, `unexpected errors: ${JSON.stringify(r.errors)}`);
  });

  it("missing project-ledger.md → error", () => {
    const root = setupFixture({});
    const r = checkTrackedItems({ rootDir: root, now: new Date("2026-05-05") });
    assert.ok(
      r.errors.some((e) => e.kind === "missing-ledger"),
      JSON.stringify(r.errors),
    );
  });
});
