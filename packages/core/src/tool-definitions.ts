export type ToolName = "read_file" | "grep_files" | "exec_shell";

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  status: "success" | "error";
  content: string;
  error?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    strict?: boolean;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
      additionalProperties?: boolean;
    };
  };
}

export const READ_FILE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "读取指定文件的完整内容。在生成 patch 前用于确认文件的最新状态。每次调用读取一个文件。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对于项目根目录的文件路径，例如 packages/core/src/verifier.ts",
        },
        offset: {
          type: "string",
          description: "可选，1-based 起始行号；用于读取大文件的一段内容",
        },
        limit: {
          type: "string",
          description: "可选，最多读取多少行；需与 offset 一起使用",
        },
      },
      required: ["path"],
    },
  },
};

export const GREP_FILES_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: "grep_files",
    description:
      "在项目中搜索匹配正则模式的内容。用于查找函数定义、调用点、import 语句等。返回匹配的文件路径、行号和内容摘要。",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "JavaScript 正则表达式模式，例如 runTask、import.*from.*benchmark-runner",
        },
        include: {
          type: "string",
          description: "可选的文件类型过滤 glob，例如 *.ts、*.test.ts。不指定则搜索所有文本文件。",
        },
      },
      required: ["pattern"],
    },
  },
};

export const EXEC_SHELL_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: "exec_shell",
    description:
      "执行只读的 shell 命令（运行 test/lint/typecheck 等验证命令、查看 git 状态）。命令默认在仓库根目录执行；在子目录运行用 cd <子目录> && <命令>（子目录须在项目内，不要猜测绝对路径）。只能执行安全命令，写入操作会被拒绝。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "要执行的 shell 命令，例如 'pnpm --filter @dsh/repo test'、'git diff --stat'",
        },
      },
      required: ["command"],
    },
  },
};

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  READ_FILE_DEF,
  GREP_FILES_DEF,
  EXEC_SHELL_DEF,
];

/** 命令必须以这些前缀之一开头才被允许执行 */
export const EXEC_SHELL_ALLOW_LIST = [
  "pnpm run test",
  "pnpm test",
  "pnpm --filter",
  "pnpm run lint",
  "pnpm run typecheck",
  "pnpm run build",
  "pnpm run scan",
  "npm test",
  "npm run test",
  "npm run lint",
  "npm run typecheck",
  "npm exec",
  "pnpm install",
  "npm install",
  "mvn install",
  "mvn compile",
  "mvn test",
  "pip install",
  "npx jest",
  "npx eslint",
  "npx tsc",
  "npx vitest",
  "tsx ",
  "node --import tsx --test",
  "node --import tsx",
  "python3 -m pytest",
  "python3 ",
  "pytest",
  "go test",
  "cargo test",
  "cd ",
  "sed ",
  "cat ",
  "head ",
  "tail ",
  "wc ",
  "git diff",
  "git log",
  "git status",
  "git branch",
  "pwd",
  "ls ",
  "find ",
  "grep ",
  "rg ",
];

/**
 * 命令中包含这些模式则拒绝执行。
 *
 * 输出重定向（`>`、`>>`、`2>file`）会写文件，必须拒；但 `2>&1`、`&>/dev/null`
 * 等 fd 复制不写文件，是常见的"丢弃 stderr"用法（模型实测会用），允许通过。
 * 用前瞻判断：`>` 之后必须是非空白且非 `&` 字符才视为重定向到文件 / 文件描述符。
 */
export const EXEC_SHELL_BLOCK_PATTERNS = [
  /\brm\b/,
  /\brmdir\b/,
  /\bunlink\b/,
  />{1,2}\s*[^\s&]/,
  /\|/,
  /\$\(/,
  /`/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /git\s+push/,
  /git\s+commit/,
  /git\s+merge/,
  /git\s+rebase/,
  /&&/,
  /;/,
  /\bmv\b/,
  /\bcp\b/,
  /\bdd\b/,
  /\bmkfs\b/,
  /\bmount\b/,
];
