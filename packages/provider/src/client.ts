// ---- Types ----

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: DeepSeekToolCall[];
  prefix?: boolean;
}

export interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface DeepSeekToolResultMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type DeepSeekReasoningEffort = "high" | "max";
export type DeepSeekEndpointMode = "official" | "openai-compatible-v1";

export interface DeepSeekTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    strict?: boolean;
    parameters?: Record<string, unknown>;
  };
}

export interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  thinking?: boolean;
  reasoningEffort?: DeepSeekReasoningEffort;
  max_tokens?: number;
  maxTokens?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  stream?: boolean;
  tools?: DeepSeekTool[] | Record<string, unknown>[];
  responseFormat?: {
    type: "json_object";
  };
  userId?: string;
}

export interface DeepSeekChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
    reasoning_content?: string;
    tool_calls?: DeepSeekToolCall[];
  };
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
}

export interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage?: DeepSeekUsage;
}

export interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }[];
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export class DeepSeekApiError extends DeepSeekError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    public readonly retryable: boolean = false,
  ) {
    super(message, status, body);
    this.name = "DeepSeekApiError";
  }
}

export interface DeepSeekRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface DeepSeekFeatureFlags {
  strictToolCalls?: boolean;
  chatPrefix?: boolean;
  fim?: boolean;
  userId?: boolean;
}

export interface DeepSeekFimRequest {
  model: string;
  prompt: string;
  suffix?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface DeepSeekFimResponse {
  content: string;
  usage?: DeepSeekUsage;
}

// ---- Client ----

export interface DeepSeekClientConfig {
  apiKey: string;
  baseUrl?: string;
  betaBaseUrl?: string;
  endpointMode?: DeepSeekEndpointMode;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryOptions?: Partial<DeepSeekRetryOptions>;
  featureFlags?: DeepSeekFeatureFlags;
  userId?: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_RETRY_OPTIONS: DeepSeekRetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
};
const LATENCY_WARN_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const THINKING_DISALLOWED_KEYS = [
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "logprobs",
  "top_logprobs",
];

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly betaBaseUrl?: string;
  private readonly endpointMode: DeepSeekEndpointMode;
  private readonly timeoutMs: number;
  private readonly retryOptions: DeepSeekRetryOptions;
  private readonly featureFlags: DeepSeekFeatureFlags;
  private readonly userId?: string;

  constructor(config: DeepSeekClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = trimTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL);
    this.betaBaseUrl = config.betaBaseUrl ? trimTrailingSlash(config.betaBaseUrl) : undefined;
    this.endpointMode = config.endpointMode ?? "official";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryOptions = {
      maxRetries: config.retryOptions?.maxRetries ?? config.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
      baseDelayMs: config.retryOptions?.baseDelayMs ?? config.retryBackoffMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs,
      maxDelayMs: config.retryOptions?.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs,
    };
    this.featureFlags = config.featureFlags ?? {};
    this.userId = config.userId;
  }

  static fromEnv(): DeepSeekClient {
    const apiKey = process.env["DEEPSEEK_API_KEY"];

    if (!apiKey) {
      throw new DeepSeekError(
        "DEEPSEEK_API_KEY environment variable is not set",
      );
    }
    return new DeepSeekClient({
      apiKey,
      baseUrl: process.env["DEEPSEEK_BASE_URL"],
      betaBaseUrl: process.env["DEEPSEEK_BETA_BASE_URL"],
    });
  }

  async chat(
    req: DeepSeekRequest,
    signal?: AbortSignal,
  ): Promise<DeepSeekResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.computeRetryDelay(attempt);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const startTime = Date.now();
      try {
        const result = await this._doChat(req, signal);
        const elapsed = Date.now() - startTime;

        if (elapsed > LATENCY_WARN_MS) {
          console.warn(
            `DeepSeek API call took ${(elapsed / 1000).toFixed(0)}s (model: ${req.model}, attempt: ${attempt + 1}/${this.retryOptions.maxRetries + 1})`,
          );
        }

        return result;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        if (e instanceof DeepSeekApiError && !e.retryable) {
          throw e;
        }

        if (
          e instanceof DeepSeekError &&
          !(e instanceof DeepSeekApiError) &&
          !e.message.includes("Network error") &&
          !e.message.includes("timed out")
        ) {
          throw e;
        }

        if (e instanceof DeepSeekApiError && e.retryable && attempt >= this.retryOptions.maxRetries) {
          throw e;
        }

        if (attempt < this.retryOptions.maxRetries) {
          const elapsed = Date.now() - startTime;
          const status = e instanceof DeepSeekError ? e.status : undefined;
          console.warn(
            `DeepSeek API retry ${attempt + 1}/${this.retryOptions.maxRetries} after error: ${lastError.message} (status=${status ?? "network"}, duration=${elapsed}ms)`,
          );
        }
      }
    }

    throw lastError ?? new DeepSeekError("Request failed after retries");
  }

  private async _doChat(
    req: DeepSeekRequest,
    signal?: AbortSignal,
  ): Promise<DeepSeekResponse> {
    const body = this.buildRequestBody(req);
    const headers = this.buildHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let bodyTimeoutId: ReturnType<typeof setTimeout> | null = null;

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(this.chatCompletionUrl(body), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await readErrorBody(res);
        throw new DeepSeekApiError(
          `DeepSeek API error ${res.status}: ${res.statusText}`,
          res.status,
          errorBody,
          RETRYABLE_STATUSES.has(res.status),
        );
      }

      // Wrap body read with a timeout. The AbortSignal on fetch covers the
      // connection phase, but when a proxy kills the tunnel mid-response the
      // socket enters CLOSE_WAIT and res.json() can hang indefinitely on a
      // half-closed connection that undici's body reader never detects as EOF.
      const json = (await Promise.race([
        res.json(),
        new Promise<never>((_, reject) => {
          bodyTimeoutId = setTimeout(() => {
            controller.abort();
            reject(new DOMException("Body read timed out", "AbortError"));
          }, this.timeoutMs);
        }),
      ])) as DeepSeekResponse;
      return json;
    } catch (e) {
      if (e instanceof DeepSeekError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new DeepSeekError("Request timed out");
      }
      throw new DeepSeekError(
        `Network error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      if (bodyTimeoutId) clearTimeout(bodyTimeoutId);
      clearTimeout(timeoutId);
    }
  }

  async *chatStream(
    req: DeepSeekRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<DeepSeekStreamChunk> {
    const body = this.buildRequestBody({ ...req, stream: true });
    const headers = this.buildHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(this.chatCompletionUrl(body), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await readErrorBody(res);
        throw new DeepSeekApiError(
          `DeepSeek API error ${res.status}: ${res.statusText}`,
          res.status,
          errorBody,
          RETRYABLE_STATUSES.has(res.status),
        );
      }

      const reader = res.body?.getReader();
      if (!reader) throw new DeepSeekError("Response body is not readable");

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") return;
            try {
              const chunk = JSON.parse(data) as DeepSeekStreamChunk;
              yield chunk;
            } catch {
              // skip unparseable lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      if (e instanceof DeepSeekError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new DeepSeekError("Stream timed out");
      }
      throw new DeepSeekError(
        `Stream error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fim(req: DeepSeekFimRequest, signal?: AbortSignal): Promise<DeepSeekFimResponse> {
    if (!this.featureFlags.fim) {
      throw new DeepSeekError("DeepSeek FIM is experimental and requires featureFlags.fim=true");
    }

    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
    };
    if (req.suffix !== undefined) body["suffix"] = req.suffix;
    if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
    if (req.temperature !== undefined) body["temperature"] = req.temperature;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) signal.addEventListener("abort", () => controller.abort());

    try {
      const res = await fetch(`${this.baseUrl}/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorBody = await readErrorBody(res);
        throw new DeepSeekApiError(
          `DeepSeek API error ${res.status}: ${res.statusText}`,
          res.status,
          errorBody,
          RETRYABLE_STATUSES.has(res.status),
        );
      }
      const json = await res.json() as {
        choices?: Array<{ text?: string; message?: { content?: string } }>;
        usage?: DeepSeekUsage;
      };
      return {
        content: json.choices?.[0]?.text ?? json.choices?.[0]?.message?.content ?? "",
        usage: json.usage,
      };
    } catch (e) {
      if (e instanceof DeepSeekError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new DeepSeekError("FIM request timed out");
      }
      throw new DeepSeekError(
        `FIM network error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildRequestBody(req: DeepSeekRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };

    if (req.thinking !== undefined) {
      body["thinking"] = {
        type: req.thinking ? "enabled" : "disabled",
      };
    }

    if (req.thinking) {
      body["reasoning_effort"] = req.reasoningEffort ?? "high";
    }

    const maxTokens = req.max_tokens ?? req.maxTokens;
    if (maxTokens !== undefined) body["max_tokens"] = maxTokens;
    if (req.temperature !== undefined) body["temperature"] = req.temperature;
    if (req.top_p !== undefined) body["top_p"] = req.top_p;
    if (req.presence_penalty !== undefined) body["presence_penalty"] = req.presence_penalty;
    if (req.frequency_penalty !== undefined) body["frequency_penalty"] = req.frequency_penalty;
    if (req.logprobs !== undefined) body["logprobs"] = req.logprobs;
    if (req.top_logprobs !== undefined) body["top_logprobs"] = req.top_logprobs;
    if (req.stream !== undefined) body["stream"] = req.stream;
    if (req.tools !== undefined) body["tools"] = this.prepareTools(req.tools);
    if (req.responseFormat !== undefined) body["response_format"] = req.responseFormat;

    const userId = req.userId ?? this.userId;
    if (userId !== undefined) {
      if (!this.featureFlags.userId) {
        throw new DeepSeekError("DeepSeek user_id requires featureFlags.userId=true");
      }
      if (!isValidUserId(userId)) {
        throw new DeepSeekError("DeepSeek user_id may only contain letters, numbers, underscore, dot, and hyphen");
      }
      body["user_id"] = userId;
    }

    return sanitizeThinkingRequestBody(body);
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "Accept": "application/json",
    };
  }

  private chatCompletionUrl(body: Record<string, unknown>): string {
    if (hasPrefixMessage(body)) {
      if (!this.featureFlags.chatPrefix || !this.betaBaseUrl) {
        throw new DeepSeekError("DeepSeek chat prefix requires featureFlags.chatPrefix=true and betaBaseUrl");
      }
      return `${this.betaBaseUrl}/chat/completions`;
    }

    if (hasStrictTool(body)) {
      if (!this.featureFlags.strictToolCalls || !this.betaBaseUrl) {
        throw new DeepSeekError("DeepSeek strict tool calls require featureFlags.strictToolCalls=true and betaBaseUrl");
      }
      return `${this.betaBaseUrl}/chat/completions`;
    }

    const suffix = this.endpointMode === "openai-compatible-v1"
      ? "/v1/chat/completions"
      : "/chat/completions";
    return `${this.baseUrl}${suffix}`;
  }

  private prepareTools(tools: DeepSeekRequest["tools"]): Record<string, unknown>[] {
    return (tools ?? []).map((tool) => {
      const copy = structuredClone(tool) as Record<string, unknown>;
      const fn = copy["function"];
      if (!fn || typeof fn !== "object" || Array.isArray(fn)) return copy;

      const functionDef = fn as Record<string, unknown>;
      if (functionDef["strict"] === true) {
        if (!this.featureFlags.strictToolCalls || !this.betaBaseUrl) {
          throw new DeepSeekError("DeepSeek strict tool calls require featureFlags.strictToolCalls=true and betaBaseUrl");
        }
        validateStrictToolParameters(functionDef["parameters"]);
      } else if (!this.featureFlags.strictToolCalls) {
        delete functionDef["strict"];
      }
      return copy;
    });
  }

  private computeRetryDelay(attempt: number): number {
    const exponential = this.retryOptions.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, this.retryOptions.maxDelayMs);
    if (capped <= 0) return 0;
    return Math.floor(capped * (0.5 + Math.random() * 0.5));
  }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function sanitizeThinkingRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const thinking = body["thinking"];
  const enabled = typeof thinking === "object" &&
    thinking !== null &&
    !Array.isArray(thinking) &&
    (thinking as Record<string, unknown>)["type"] === "enabled";

  if (!enabled) return body;

  for (const key of THINKING_DISALLOWED_KEYS) {
    if (key in body) {
      console.warn(`DeepSeek thinking mode ignores unsupported sampling parameter: ${key}`);
      delete body[key];
    }
  }
  return body;
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function hasPrefixMessage(body: Record<string, unknown>): boolean {
  const messages = body["messages"];
  return Array.isArray(messages) && messages.some((message) =>
    typeof message === "object" &&
    message !== null &&
    !Array.isArray(message) &&
    (message as Record<string, unknown>)["prefix"] === true
  );
}

function hasStrictTool(body: Record<string, unknown>): boolean {
  const tools = body["tools"];
  return Array.isArray(tools) && tools.some((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const fn = (tool as Record<string, unknown>)["function"];
    return Boolean(
      fn &&
      typeof fn === "object" &&
      !Array.isArray(fn) &&
      (fn as Record<string, unknown>)["strict"] === true,
    );
  });
}

function validateStrictToolParameters(parameters: unknown): void {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new DeepSeekError("Strict tool calls require object parameters schema");
  }
  const params = parameters as Record<string, unknown>;
  if (params["type"] !== "object") {
    throw new DeepSeekError("Strict tool calls require parameters.type=object");
  }
  if (params["additionalProperties"] !== false) {
    throw new DeepSeekError("Strict tool calls require parameters.additionalProperties=false");
  }
}

function isValidUserId(userId: string): boolean {
  return /^[A-Za-z0-9_.-]{1,128}$/.test(userId);
}
