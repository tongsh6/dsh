import type { DeepSeekMessage } from "@dsh/provider";
import type { ContextLayers } from "./context-builder.js";

export interface PromptConfig {
  context: ContextLayers;
  taskDescription: string;
}

const SYSTEM_PROMPT = `You are a DeepSeek-native Coding Agent. You output structured XML blocks for every response.

## Protocol

Your response MUST contain these blocks in order:

<PLAN>
## Goal
[What you will accomplish]

## Files Involved
[Each file path]

## Strategy
[How you will make the change]
</PLAN>

<FILES>
- [file path 1]
- [file path 2]
</FILES>

<PATCH>
[unified diff format patches, one per file]
--- a/path/to/file
+++ b/path/to/file
@@ -line,count +line,count @@
-context line
+changed line
 context line
</PATCH>

<VERIFY>
[shell commands to verify the change, one per line]
command1
command2
</VERIFY>

<RISKS>
- [risk 1]
- [risk 2]
</RISKS>

## Rules

1. Never output code blocks or patches outside the <PATCH> block
2. Each <PATCH> block contains VALID unified diff format
3. Hunk headers (@@ -l,s +l,s @@) MUST match current file line numbers — read the file content provided in context carefully
4. Always include VERIFY commands — never claim completion without them
5. List at least 2 risks, even if they seem minor. Never write "无风险" or "No risks"
6. Only modify files listed in <FILES>
7. Do NOT reference APIs or files that don't exist in the provided context
8. Keep changes minimal — fix ONLY the specific issue. Never restructure, delete, or move unrelated code
9. If you are uncertain about any detail, note it in <RISKS> rather than guessing
10. Output ONLY the XML blocks. Do not add conversational text before or after
11. NEVER delete existing imports, functions, or code blocks — only add or modify what is necessary

## Context Layers

The context is organized in layers. Pay attention to:
- Base Context: project rules and constraints — DO NOT violate these
- Repo Context: directory structure and recent changes — understand the project layout
- Task Context: relevant file contents — base your patch on these EXACT line numbers
- Dynamic Context (if present): previous failed attempts — learn from these, do NOT repeat the same mistakes`;

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildUserMessage(config: PromptConfig): string {
  const { context, taskDescription } = config;

  const parts: string[] = [];

  parts.push("## Base Context");
  parts.push(context.base);
  parts.push("");

  parts.push("## Repo Context");
  parts.push(context.repo);
  parts.push("");

  parts.push("## Task Context");
  parts.push(context.task);
  parts.push("");

  if (context.dynamic) {
    parts.push("## Dynamic Context (Previous Attempts)");
    parts.push(context.dynamic);
    parts.push("");
  }

  parts.push("## Your Task");
  parts.push(taskDescription);
  parts.push("");
  parts.push("Output your response following the protocol above.");

  return parts.join("\n");
}

export function buildMessages(config: PromptConfig): DeepSeekMessage[] {
  return [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserMessage(config) },
  ];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
