import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXEC_SHELL_ALLOW_LIST, EXEC_SHELL_BLOCK_PATTERNS } from "./tool-definitions.js";
import type { ToolResult } from "./tool-definitions.js";

const READ_FILE_MAX_BYTES = 50_000;
const GREP_MAX_RESULTS = 30;
const GREP_RESULT_LINE_MAX_CHARS = 200;
const GREP_TIMEOUT_MS = 10_000;
const EXEC_SHELL_TIMEOUT_MS = 120_000;
const EXEC_SHELL_MAX_OUTPUT = 100_000;
const PROTOCOL_BLOCK_NAMES = new Set(["CREATE", "PATCH", "INSERT", "DELETE", "RENAME"]);

const SKIP_DIRS = /\/node_modules\/|\/\.git\/|\/dist\/|\/\.dsh\/|\/__pycache__\/|\/\.next\/|\/build\/|\/coverage\//i;

function isSafePath(filePath: string): boolean {
  if (path.isAbsolute(filePath)) return false;
  if (filePath.includes("..")) return false;
  return true;
}

export function isShellAllowed(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) return "命令为空";

  const matched = EXEC_SHELL_ALLOW_LIST.some((prefix) => trimmed.startsWith(prefix));
  if (!matched) {
    return `命令 "${trimmed.slice(0, 80)}" 不在允许列表中。允许的命令前缀: ${EXEC_SHELL_ALLOW_LIST.slice(0, 10).join(", ")}...`;
  }

  for (const pattern of EXEC_SHELL_BLOCK_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Allow safe pipe patterns: `| head`, `| tail`, `| grep` (reading operations)
      if (pattern.source === "\\|" || pattern.source === "\\/\\|\\/") {
        const pipeMatch = trimmed.match(/\|\s*([^|]+)$/);
        if (pipeMatch) {
          const afterPipe = pipeMatch[1]?.trimStart() ?? "";
          const safePipes = ["head ", "tail ", "grep ", "rg "];
          if (safePipes.some((p) => afterPipe.startsWith(p))) continue;
        }
        // Allow common safe error suppression: `|| true`, `|| echo ...`
        if (trimmed.includes("||")) {
          const orMatch = trimmed.match(/\|\|\s*([^|&;]+)$/);
          if (orMatch) {
            const afterOr = orMatch[1]?.trimStart() ?? "";
            const safeOrs = ["true", "echo ", "exit 0"];
            if (safeOrs.some((p) => afterOr.startsWith(p))) continue;
          }
        }
      }

      // Allow `cd <dir> && <cmd>` — model's common chdir + run pattern
      if (pattern.source === "&&" && trimmed.startsWith("cd ")) {
        const parts = trimmed.split("&&");
        if (parts.length === 2) {
          const second = parts[1]?.trimStart() ?? "";
          if (EXEC_SHELL_ALLOW_LIST.some((p) => second.startsWith(p))) continue;
        }
      }

      return `命令包含禁止的模式: ${String(pattern)}`;
    }
  }

  return null;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readFileImpl(filePath: string, cwd: string, offset?: string, limit?: string): string {
  if (!isSafePath(filePath)) {
    return `错误: 路径不安全 — "${filePath}"。必须使用相对路径，不能包含 ..`;
  }

  const absPath = path.join(cwd, filePath);

  if (!fs.existsSync(absPath)) {
    return `错误: 文件不存在 — "${filePath}"`;
  }

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    return `错误: "${filePath}" 是目录，不是文件`;
  }

  const content = fs.readFileSync(absPath, "utf-8");
  const offsetLine = parsePositiveInt(offset);
  const limitLines = parsePositiveInt(limit);

  if (offsetLine !== null || limitLines !== null) {
    const lines = content.split("\n");
    const start = Math.max((offsetLine ?? 1) - 1, 0);
    const end = limitLines !== null ? Math.min(start + limitLines, lines.length) : lines.length;
    const selected = lines.slice(start, end).join("\n");
    return [
      `### ${filePath} (lines ${start + 1}-${end} of ${lines.length})`,
      "```",
      selected,
      "```",
    ].join("\n");
  }

  if (stat.size > READ_FILE_MAX_BYTES) {
    const lines = content.split("\n");
    // When file has <= 1000 lines, show all content even if bytes exceed limit
    if (lines.length <= 1000) {
      return [`### ${filePath}`, "```", content, "```"].join("\n");
    }
    const head = lines.slice(0, 800).join("\n");
    const tail = lines.slice(-200).join("\n");
    const omitted = lines.length - 1000;
    return [
      `⚠️ 文件过大（${stat.size} 字节，${lines.length} 行）。显示前 800 行和后 200 行。`,
      "",
      `### ${filePath} (行 1-800)`,
      "```",
      head,
      "```",
      "",
      `...[省略 ${omitted} 行]...`,
      "",
      `### ${filePath} (行 ${lines.length - 199}-${lines.length})`,
      "```",
      tail,
      "```",
    ].join("\n");
  }

  return [`### ${filePath}`, "```", content, "```"].join("\n");
}

function grepFilesImpl(
  pattern: string,
  include: string | undefined,
  cwd: string,
): string {
  if (!pattern || pattern.trim().length === 0) {
    return "错误: 搜索模式不能为空";
  }

  const includeGlob = include && include.trim().length > 0 ? include.trim() : "*";

  try {
    const grepCmd = `grep -rn --include="${includeGlob}" "${pattern}" . 2>/dev/null`;
    const output = execSync(grepCmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GREP_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
    }).trim();

    if (!output) {
      return `未找到匹配 "${pattern}" 的结果`;
    }

    const allLines = output.split(/\r?\n/).filter((l) => {
      const filePart = l.split(":")[0] ?? "";
      return !SKIP_DIRS.test(filePart);
    });

    if (allLines.length === 0) {
      return `未找到匹配 "${pattern}" 的结果（已跳过 node_modules/.git/dist 等目录）`;
    }

    const limited = allLines.slice(0, GREP_MAX_RESULTS);
    const formatted = limited.map((line) => {
      const m = line.match(/^\.?\/?(.+?):(\d+):(.*)$/);
      if (!m) return line;
      const f = m[1] ?? "";
      const lnum = m[2] ?? "?";
      const content = (m[3] ?? "").trim().slice(0, GREP_RESULT_LINE_MAX_CHARS);
      return `- \`${f}:${lnum}\` — ${content}`;
    });

    const header =
      allLines.length > GREP_MAX_RESULTS
        ? `找到 ${allLines.length} 处匹配（显示前 ${GREP_MAX_RESULTS} 条）:`
        : `找到 ${allLines.length} 处匹配:`;

    return [header, ...formatted].join("\n");
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: string; message?: string };
    if (err.status === 1) {
      return `未找到匹配 "${pattern}" 的结果`;
    }
    const detail = err.stderr ?? err.message ?? "未知错误";
    return `错误: grep 执行失败 — ${String(detail).slice(0, 200)}`;
  }
}

function execShellImpl(command: string, cwd: string): ToolResult {
  const allowedError = isShellAllowed(command);
  if (allowedError) {
    return { callId: "", status: "error", content: "", error: allowedError };
  }

  const start = Date.now();
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"], // capture stdout and stderr
      timeout: EXEC_SHELL_TIMEOUT_MS,
      maxBuffer: EXEC_SHELL_MAX_OUTPUT,
    });
    const duration = Date.now() - start;

    const out = output.trim() || "(无输出)";
    const truncated = out.length > EXEC_SHELL_MAX_OUTPUT
      ? out.slice(0, EXEC_SHELL_MAX_OUTPUT) + `\n...[截断，总长度 ${out.length}]`
      : out;

    return {
      callId: "",
      status: "success",
      content: [
        "Exit code: 0",
        `Duration: ${duration}ms`,
        "",
        "```",
        truncated,
        "```",
      ].join("\n"),
    };
  } catch (e: unknown) {
    const duration = Date.now() - start;
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    const combined = [err.stdout ?? "", err.stderr ?? ""].filter(Boolean).join("\n");
    const out = combined.trim() || err.message || "未知错误";

    return {
      callId: "",
      status: "error",
      content: [
        `Exit code: ${err.status ?? 1}`,
        `Duration: ${duration}ms`,
        "",
        "```",
        out.slice(0, EXEC_SHELL_MAX_OUTPUT),
        "```",
      ].join("\n"),
      error: `命令执行失败 (exit code: ${err.status ?? 1})`,
    };
  }
}

export function executeTool(
  name: string,
  args: Record<string, string>,
  cwd: string,
  callId: string = "test-call-id",
): ToolResult {
  switch (name) {
    case "read_file": {
      const filePath = args["path"];
      if (!filePath) {
        return { callId, status: "error", content: "", error: "缺少必填参数 path" };
      }
      const content = readFileImpl(filePath, cwd, args["offset"], args["limit"]);
      const isError = content.startsWith("错误:");
      return {
        callId,
        status: isError ? "error" : "success",
        content,
        error: isError ? content : undefined,
      };
    }

    case "grep_files": {
      const pattern = args["pattern"];
      if (!pattern) {
        return { callId, status: "error", content: "", error: "缺少必填参数 pattern" };
      }
      const content = grepFilesImpl(pattern, args["include"], cwd);
      const isError = content.startsWith("错误:");
      return {
        callId,
        status: isError ? "error" : "success",
        content,
        error: isError ? content : undefined,
      };
    }

    case "exec_shell": {
      const command = args["command"];
      if (!command) {
        return { callId, status: "error", content: "", error: "缺少必填参数 command" };
      }
      const result = execShellImpl(command, cwd);
      return { ...result, callId };
    }

    default: {
      const upper = name.toUpperCase();
      if (PROTOCOL_BLOCK_NAMES.has(upper) || name === "create_file" || name === "create") {
        const blockName = upper === "CREATE_FILE" ? "CREATE" : upper;
        return {
          callId,
          status: "error",
          content: "",
          error:
            `${name} is not a callable tool. To modify files, put a ` +
            `<${blockName}>...</${blockName}> change block directly in assistant content ` +
            "with no tool_calls. Available callable tools are read_file, grep_files, and exec_shell.",
        };
      }
      return {
        callId,
        status: "error",
        content: "",
        error: `未知工具: ${name}`,
      };
    }
  }
}

export function formatToolResult(
  name: string,
  args: Record<string, string>,
  result: ToolResult,
): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}="${v}"`)
    .join(", ");
  const header = `## 工具调用结果: ${name}(${argStr})`;
  if (result.status === "error") {
    const errorMsg = result.error ?? "未知错误";
    const body = result.content ? `\n\n${result.content}` : "";
    return `${header}\n\n❌ 错误: ${errorMsg}${body}`;
  }
  return `${header}\n\n${result.content}`;
}
