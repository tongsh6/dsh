import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { executeTool, isShellAllowed, formatToolResult } from "./tool-executor.js";

describe("isShellAllowed", () => {
  it("allows pnpm test commands", () => {
    assert.equal(isShellAllowed("pnpm test"), null);
    assert.equal(isShellAllowed("pnpm run test"), null);
    assert.equal(isShellAllowed("pnpm --filter @dsh/repo test"), null);
    assert.equal(isShellAllowed("pnpm run lint"), null);
    assert.equal(isShellAllowed("pnpm run typecheck"), null);
  });

  it("allows npm test commands", () => {
    assert.equal(isShellAllowed("npm test"), null);
    assert.equal(isShellAllowed("npm run test"), null);
  });

  it("allows npx commands", () => {
    assert.equal(isShellAllowed("npx jest --no-coverage"), null);
    assert.equal(isShellAllowed("npx tsc --noEmit"), null);
    assert.equal(isShellAllowed("npx eslint src/"), null);
  });

  it("allows git read-only commands", () => {
    assert.equal(isShellAllowed("git diff --stat"), null);
    assert.equal(isShellAllowed("git log --oneline -10"), null);
    assert.equal(isShellAllowed("git status"), null);
    assert.equal(isShellAllowed("git branch"), null);
  });

  it("allows read-only file inspection commands", () => {
    assert.equal(isShellAllowed("cat package.json"), null);
    assert.equal(isShellAllowed("head -20 src/main.ts"), null);
    assert.equal(isShellAllowed("ls -la"), null);
    assert.equal(isShellAllowed("find . -name '*.ts'"), null);
    assert.equal(isShellAllowed("grep -rn 'pattern' ."), null);
  });

  it("rejects destructive commands", () => {
    assert.ok(isShellAllowed("rm -rf node_modules"));
    assert.ok(isShellAllowed("sudo ls"));
    assert.ok(isShellAllowed("chmod 777 file"));
  });

  it("rejects network commands", () => {
    assert.ok(isShellAllowed("curl http://example.com"));
    assert.ok(isShellAllowed("wget http://example.com"));
  });

  it("rejects destructive git operations", () => {
    assert.ok(isShellAllowed("git push"));
    assert.ok(isShellAllowed("git commit -m 'test'"));
    assert.ok(isShellAllowed("git rebase main"));
    assert.ok(isShellAllowed("git merge feature"));
  });

  it("rejects command chaining and redirection", () => {
    assert.ok(isShellAllowed("pnpm test && rm -rf /"));
    assert.ok(isShellAllowed("pnpm test; cat /etc/passwd"));
    assert.ok(isShellAllowed("pnpm test > /tmp/output"));
    assert.ok(isShellAllowed("pnpm test >> /tmp/output"));
    assert.ok(isShellAllowed("pnpm test 2>err.log"));
    assert.ok(isShellAllowed("echo test | grep test"));
  });

  it("rejects shell write attempts even when they look non-destructive", () => {
    assert.ok(isShellAllowed("mkdir -p src/generated"));
    assert.ok(isShellAllowed("touch src/generated/file.ts"));
    assert.ok(isShellAllowed("cat > src/generated/file.ts"));
  });

  it("allows fd duplication (2>&1) — not a file write", () => {
    // 2>&1 is "redirect stderr to wherever stdout goes" — a fd copy, not a file write.
    // Models commonly use `cmd 2>&1` to capture both streams; previously over-strict
    // /\>/ pattern rejected this.
    assert.equal(isShellAllowed("pnpm run typecheck 2>&1"), null);
    assert.equal(isShellAllowed("pnpm test 2>&1"), null);
  });

  it("allows expanded command prefixes (node --import tsx, sed, python3)", () => {
    assert.equal(isShellAllowed("node --import tsx --test packages/cli/test.ts"), null);
    assert.equal(isShellAllowed("node --import tsx packages/cli/test.ts"), null);
    assert.equal(isShellAllowed("sed -n '10,20p' file.ts"), null);
    assert.equal(isShellAllowed("python3 tools/check.py --root ."), null);
    assert.equal(isShellAllowed("npm exec tsx run-benchmark.ts"), null);
  });

  it("allows safe pipe patterns (| head, | tail, | grep)", () => {
    assert.equal(isShellAllowed("pnpm run typecheck 2>&1 | head -20"), null);
    assert.equal(isShellAllowed("cat package.json | grep name"), null);
    assert.equal(isShellAllowed("git log --oneline | head -5"), null);
    assert.equal(isShellAllowed("ls -la | tail -10"), null);
  });

  it("rejects dangerous pipe patterns", () => {
    assert.ok(isShellAllowed("pnpm test | wc -l")); // wc is not in safePipes
    assert.ok(isShellAllowed("ls | xargs rm")); // destructive
  });

  it("rejects unrecognized commands", () => {
    assert.ok(isShellAllowed("some-random-command --flag"));
    assert.ok(isShellAllowed("whoami"));
    assert.ok(isShellAllowed("env"));
  });

  it("rejects empty command", () => {
    assert.ok(isShellAllowed(""));
    assert.ok(isShellAllowed("   "));
  });

  it("allows pwd so a disoriented model can re-orient", () => {
    assert.equal(isShellAllowed("pwd"), null);
  });

  it("allows discarding output to /dev/null (not a real file write)", () => {
    assert.equal(isShellAllowed("pnpm run typecheck 2>/dev/null"), null);
    assert.equal(isShellAllowed("pnpm test >/dev/null"), null);
    assert.equal(isShellAllowed("pnpm test &>/dev/null"), null);
    assert.equal(isShellAllowed("pnpm test 2>/dev/null | tail -20"), null);
    // a redirect to a real file is still rejected
    assert.ok(isShellAllowed("pnpm test 2>err.log"));
    assert.ok(isShellAllowed("pnpm test > out.txt"));
  });

  it("allows cd <subdir> && <cmd> — running a command in a subdirectory is legitimate", () => {
    assert.equal(isShellAllowed("cd packages/cli && pnpm test"), null);
    assert.equal(isShellAllowed("cd backend && mvn test"), null);
    // the command chained after cd must still itself be allowlisted
    assert.ok(isShellAllowed("cd .. && rm -rf /"));
  });
});

describe("executeTool with read_file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads file content successfully", () => {
    const filePath = "test.txt";
    fs.writeFileSync(path.join(tmpDir, filePath), "hello world\nline 2\n", "utf-8");

    const result = executeTool("read_file", { path: filePath }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("hello world"));
    assert.ok(result.content.includes("line 2"));
    assert.ok(result.content.includes("test.txt"));
  });

  it("reads a line range when offset and limit are provided", () => {
    const filePath = "range.txt";
    fs.writeFileSync(path.join(tmpDir, filePath), "one\ntwo\nthree\nfour", "utf-8");

    const result = executeTool("read_file", { path: filePath, offset: "2", limit: "2" }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("lines 2-3 of 4"));
    assert.ok(result.content.includes("two\nthree"));
    assert.ok(!result.content.includes("one\n"));
    assert.ok(!result.content.includes("four"));
  });

  it("accepts numeric line range arguments", () => {
    const filePath = "range-numeric.txt";
    fs.writeFileSync(path.join(tmpDir, filePath), "one\ntwo\nthree\nfour", "utf-8");

    const result = executeTool("read_file", { path: filePath, offset: 2, limit: 2 }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("lines 2-3 of 4"));
    assert.ok(result.content.includes("two\nthree"));
    assert.ok(!result.content.includes("one\n"));
    assert.ok(!result.content.includes("four"));
  });

  it("reads from offset to end when limit is omitted", () => {
    const filePath = "range-to-end.txt";
    fs.writeFileSync(path.join(tmpDir, filePath), "one\ntwo\nthree", "utf-8");

    const result = executeTool("read_file", { path: filePath, offset: "2" }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("two\nthree"));
    assert.ok(!result.content.includes("one\n"));
  });

  it("returns error when file does not exist", () => {
    const result = executeTool("read_file", { path: "nonexistent.txt" }, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.content.includes("文件不存在"));
  });

  it("rejects absolute paths", () => {
    const result = executeTool("read_file", { path: "/etc/passwd" }, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.content.includes("路径不安全"));
  });

  it("rejects path traversal", () => {
    const result = executeTool("read_file", { path: "../../../etc/passwd" }, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.content.includes("路径不安全"));
  });

  it("rejects directory path", () => {
    fs.mkdirSync(path.join(tmpDir, "subdir"));
    const result = executeTool("read_file", { path: "subdir" }, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.content.includes("是目录"));
  });

  it("returns error when path parameter is missing", () => {
    const result = executeTool("read_file", {} as Record<string, string>, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("缺少必填参数"));
  });

  it("truncates large files", () => {
    const filePath = "large.txt";
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`line ${i}: ${"x".repeat(40)}`);
    }
    fs.writeFileSync(path.join(tmpDir, filePath), lines.join("\n"), "utf-8");

    const result = executeTool("read_file", { path: filePath }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("文件过大"));
    assert.ok(result.content.includes("省略"));
    // Should include first 800 and last 200 lines
    assert.ok(result.content.includes("line 0:"));
    assert.ok(result.content.includes("line 1999:"));
  });
});

describe("executeTool with grep_files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tool-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "foo.ts"),
      "export function helloWorld() {\n  return detectVerifyCommands();\n}\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "bar.ts"),
      "import { detectVerifyCommands } from './scanner.js';\n\ndetectVerifyCommands({});\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds matches for a pattern", () => {
    const result = executeTool("grep_files", { pattern: "detectVerifyCommands" }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("foo.ts"));
    assert.ok(result.content.includes("bar.ts"));
    assert.ok(result.content.includes("处匹配"));
  });

  it("filters by include glob", () => {
    // bar.ts doesn't have helloWorld, only foo.ts does
    const result = executeTool(
      "grep_files",
      { pattern: "helloWorld", include: "*.ts" },
      tmpDir,
    );

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("foo.ts"));
  });

  it("returns no match message when pattern not found", () => {
    const result = executeTool(
      "grep_files",
      { pattern: "thisDoesNotExistAnywhere" },
      tmpDir,
    );

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("未找到匹配"));
  });

  it("returns error when pattern is missing", () => {
    const result = executeTool("grep_files", {} as Record<string, string>, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("缺少必填参数"));
  });

  it("returns error when pattern is empty string", () => {
    const result = executeTool("grep_files", { pattern: "" }, tmpDir);

    assert.equal(result.status, "error");
    // Empty string is falsy, executeTool treats it as missing parameter
    assert.ok(result.error?.includes("缺少必填参数"));
  });
});

describe("executeTool with exec_shell", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes allowed command successfully", () => {
    const result = executeTool("exec_shell", { command: "ls -la" }, tmpDir);

    assert.equal(result.status, "success");
    assert.ok(result.content.includes("Exit code: 0"));
  });

  it("rejects dangerous command not in allow list", () => {
    const result = executeTool("exec_shell", { command: "rm -rf /" }, tmpDir);

    assert.equal(result.status, "error");
    // "rm" is not in the allow list, so it gets rejected before block pattern check
    assert.ok(result.error?.includes("不在允许列表中"));
  });

  it("rejects unrecognized command", () => {
    const result = executeTool("exec_shell", { command: "whoami" }, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("不在允许列表中"));
  });

  it("rejects command chaining", () => {
    const result = executeTool(
      "exec_shell",
      { command: "ls -la && rm -rf ." },
      tmpDir,
    );

    assert.equal(result.status, "error");
  });

  it("returns error for failed command", () => {
    const result = executeTool(
      "exec_shell",
      { command: "cat nonexistent_file_xyz" },
      tmpDir,
    );

    assert.equal(result.status, "error");
    assert.ok(result.content.includes("Exit code:"));
    const exitCode = result.content.match(/Exit code: (\d+)/)?.[1];
    assert.ok(exitCode !== undefined);
    assert.ok(Number(exitCode) !== 0);
  });

  it("returns error when command is missing", () => {
    const result = executeTool("exec_shell", {} as Record<string, string>, tmpDir);

    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("缺少必填参数"));
  });

  it("rejects cd to a nonexistent directory, naming the real working directory", () => {
    const result = executeTool(
      "exec_shell",
      { command: "cd nonexistent-subdir && pnpm test" },
      tmpDir,
    );
    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("cd 目标目录不存在"));
    assert.ok(result.error?.includes(tmpDir));
  });

  it("rejects cd that escapes the project root", () => {
    const result = executeTool(
      "exec_shell",
      { command: "cd /etc && cat passwd" },
      tmpDir,
    );
    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("超出项目根目录"));
  });

  it("allows cd into a real subdirectory", () => {
    fs.mkdirSync(path.join(tmpDir, "sub"));
    const result = executeTool("exec_shell", { command: "cd sub && ls -la" }, tmpDir);
    assert.equal(result.status, "success");
  });
});

describe("executeTool with unknown tool", () => {
  it("returns error for unknown tool name", () => {
    const result = executeTool("unknown_tool", {}, "/tmp");

    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("未知工具"));
  });

  it("explains that protocol blocks are not callable tools", () => {
    const result = executeTool("CREATE", {}, "/tmp");

    assert.equal(result.status, "error");
    assert.match(result.error ?? "", /not a callable tool/);
    assert.match(result.error ?? "", /<CREATE>/);
    assert.match(result.error ?? "", /no tool_calls/);
  });

  it("maps lowercase create tool hallucinations to CREATE block guidance", () => {
    const result = executeTool("create", {}, "/tmp");

    assert.equal(result.status, "error");
    assert.match(result.error ?? "", /<CREATE>/);
  });
});

describe("formatToolResult", () => {
  it("formats success result with tool name and args", () => {
    const result = { callId: "1", status: "success" as const, content: "file content here" };
    const formatted = formatToolResult("read_file", { path: "src/foo.ts", limit: 5 }, result);

    assert.ok(formatted.includes('path="src/foo.ts"'));
    assert.ok(formatted.includes('limit="5"'));
    assert.ok(formatted.includes("file content here"));
  });

  it("formats error result with error message", () => {
    const result = {
      callId: "1",
      status: "error" as const,
      content: "",
      error: "文件不存在",
    };
    const formatted = formatToolResult("read_file", { path: "missing.ts" }, result);

    assert.ok(formatted.includes('read_file(path="missing.ts")'));
    assert.ok(formatted.includes("文件不存在"));
    assert.ok(formatted.includes("❌"));
  });
});
