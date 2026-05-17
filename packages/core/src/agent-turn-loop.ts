import type {
  DeepSeekClient,
  DeepSeekMessage,
  DeepSeekReasoningEffort,
  DeepSeekTool,
  DeepSeekToolCall,
} from "@dsh/provider";
import { normalizeUsage, type NormalizedUsage } from "@dsh/provider";
import type { ToolName, ToolResult } from "./tool-definitions.js";
import { ALL_TOOL_DEFINITIONS, type ToolDefinition } from "./tool-definitions.js";
import type { ToolCallRecord } from "./task-state.js";
import {
  executeTool as defaultExecuteTool,
  formatToolResult,
  normalizeToolArguments,
  type ToolArguments,
} from "./tool-executor.js";

export type AgentPhase = "plan" | "patch" | "repair" | "verify" | "handoff" | "preflight";

export interface ToolPolicy {
  phase: AgentPhase;
  allowedTools: ToolName[];
}

export type ToolExecutor = (
  name: ToolName,
  args: ToolArguments,
  callId: string,
) => ToolResult | Promise<ToolResult>;

export interface AgentTurnLoopInput {
  client: DeepSeekClient;
  messages: DeepSeekMessage[];
  model: string;
  thinking: boolean;
  reasoningEffort?: DeepSeekReasoningEffort;
  tools?: DeepSeekTool[] | ToolDefinition[];
  toolExecutor?: ToolExecutor;
  toolPolicy: ToolPolicy;
  maxToolRounds: number;
}

export interface AgentTurnLoopResult {
  finalMessage: DeepSeekMessage;
  messages: DeepSeekMessage[];
  usage: NormalizedUsage;
  toolRounds: number;
}

export interface ExecuteToolCallsForPolicyInput {
  toolCalls: DeepSeekToolCall[];
  toolPolicy: ToolPolicy;
  tools?: Array<DeepSeekTool | ToolDefinition>;
  cwd: string;
  toolExecutor?: ToolExecutor;
}

export interface ExecuteToolCallsForPolicyResult {
  messages: DeepSeekMessage[];
  records: ToolCallRecord[];
}

const ZERO_USAGE: NormalizedUsage = {
  prompt: 0,
  completion: 0,
  total: 0,
  cacheHit: 0,
  cacheMiss: 0,
  reasoning: 0,
  cacheHitRatio: 0,
};

export const TOOL_POLICIES: Record<AgentPhase, ToolPolicy> = {
  plan: { phase: "plan", allowedTools: ["read_file", "grep_files"] },
  patch: { phase: "patch", allowedTools: ["read_file", "grep_files"] },
  repair: { phase: "repair", allowedTools: ["read_file", "grep_files", "exec_shell"] },
  verify: { phase: "verify", allowedTools: [] },
  handoff: { phase: "handoff", allowedTools: [] },
  preflight: { phase: "preflight", allowedTools: ["read_file", "grep_files", "exec_shell"] },
};

export function getToolPolicy(phase: AgentPhase): ToolPolicy {
  return TOOL_POLICIES[phase];
}

export async function runAgentTurnLoop(input: AgentTurnLoopInput): Promise<AgentTurnLoopResult> {
  const messages = [...input.messages];
  const allTools = (input.tools ?? ALL_TOOL_DEFINITIONS) as Array<DeepSeekTool | ToolDefinition>;
  const allowedTools = filterToolsForPolicy(allTools, input.toolPolicy);

  let usage = { ...ZERO_USAGE };
  let toolRounds = 0;

  while (true) {
    const response = await input.client.chat({
      model: input.model,
      messages,
      thinking: input.thinking,
      reasoningEffort: input.reasoningEffort,
      ...(allowedTools.length > 0 ? { tools: allowedTools as DeepSeekTool[] } : {}),
    });

    usage = addUsage(usage, normalizeUsage(response.usage));

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("DeepSeek API 返回空响应");
    }

    const assistantMessage: DeepSeekMessage = {
      role: "assistant",
      content: choice.message.content ?? "",
    };
    if (choice.message.reasoning_content) {
      assistantMessage.reasoning_content = choice.message.reasoning_content;
    }
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      assistantMessage.tool_calls = choice.message.tool_calls;
    }

    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      messages.push(assistantMessage);
      return {
        finalMessage: assistantMessage,
        messages,
        usage: withCacheRatio(usage),
        toolRounds,
      };
    }

    if (toolRounds >= input.maxToolRounds) {
      throw new Error(`maxToolRounds exceeded for ${input.toolPolicy.phase}`);
    }

    messages.push(assistantMessage);
    const toolResult = await executeToolCallsForPolicy({
      toolCalls,
      toolPolicy: input.toolPolicy,
      tools: allTools,
      cwd: process.cwd(),
      toolExecutor: input.toolExecutor,
    });
    messages.push(...toolResult.messages);

    toolRounds++;
  }
}

export async function executeToolCallsForPolicy(
  input: ExecuteToolCallsForPolicyInput,
): Promise<ExecuteToolCallsForPolicyResult> {
  const tools = input.tools ?? ALL_TOOL_DEFINITIONS;
  const executor = input.toolExecutor ?? ((name, args, callId) =>
    defaultExecuteTool(name, args, input.cwd, callId));
  const messages: DeepSeekMessage[] = [];
  const records: ToolCallRecord[] = [];

  for (const toolCall of input.toolCalls) {
    const toolName = toolCall.function.name as ToolName;
    const validation = validateToolCall(toolName, toolCall.function.arguments, input.toolPolicy, tools);
    if (!validation.ok) {
      messages.push(toolErrorMessage(toolCall.id, validation.detail));
      records.push({
        name: toolCall.function.name,
        arguments: {},
        status: "error",
        summary: validation.detail.slice(0, 200),
      });
      continue;
    }

    const result = await executor(toolName, validation.args, toolCall.id);
    const formatted = formatToolResult(toolName, validation.args, result);
    messages.push({ role: "tool", content: formatted, tool_call_id: toolCall.id });
    records.push({
      name: toolName,
      arguments: validation.args,
      status: result.status,
      summary: result.status === "success"
        ? result.content.slice(0, 200)
        : (result.error ?? "").slice(0, 200),
    });
  }

  return { messages, records };
}

export function filterToolsForPolicy(
  tools: Array<DeepSeekTool | ToolDefinition>,
  policy: ToolPolicy,
): Array<DeepSeekTool | ToolDefinition> {
  if (policy.allowedTools.length === 0) return [];
  const allowed = new Set(policy.allowedTools);
  return tools.filter((tool) => allowed.has(tool.function.name as ToolName));
}

function validateToolCall(
  name: ToolName,
  rawArguments: string,
  policy: ToolPolicy,
  tools: Array<DeepSeekTool | ToolDefinition>,
): { ok: true; args: ToolArguments } | { ok: false; detail: string } {
  if (!policy.allowedTools.includes(name)) {
    return { ok: false, detail: `Tool ${name} is not allowed during ${policy.phase}` };
  }

  let parsed: unknown;
  try {
    parsed = rawArguments && rawArguments.trim().length > 0
      ? JSON.parse(rawArguments)
      : {};
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `Invalid tool arguments JSON: ${detail}` };
  }

  const args = normalizeToolArguments(parsed);
  const required = findRequiredArgs(name, tools);
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return { ok: false, detail: `${key} is required` };
    }
  }
  return { ok: true, args };
}

function findRequiredArgs(name: ToolName, tools: Array<DeepSeekTool | ToolDefinition>): string[] {
  const tool = tools.find((candidate) => candidate.function.name === name);
  const parameters = tool?.function.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return [];
  const required = (parameters as { required?: unknown }).required;
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === "string") : [];
}

function toolErrorMessage(toolCallId: string, detail: string): DeepSeekMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify({
      error: "Invalid tool arguments",
      detail,
    }),
  };
}

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return withCacheRatio({
    prompt: a.prompt + b.prompt,
    completion: a.completion + b.completion,
    total: a.total + b.total,
    cacheHit: a.cacheHit + b.cacheHit,
    cacheMiss: a.cacheMiss + b.cacheMiss,
    reasoning: a.reasoning + b.reasoning,
    cacheHitRatio: 0,
  });
}

function withCacheRatio(usage: NormalizedUsage): NormalizedUsage {
  const cacheTotal = usage.cacheHit + usage.cacheMiss;
  return {
    ...usage,
    cacheHitRatio: cacheTotal > 0 ? usage.cacheHit / cacheTotal : 0,
  };
}
