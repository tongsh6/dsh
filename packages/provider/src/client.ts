import * as fs from "node:fs";
import * as path from "node:path";

// ---- Types ----

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  thinking?: boolean;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface DeepSeekChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
    reasoning_content?: string;
  };
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  reasoning_tokens?: number;
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage: DeepSeekUsage;
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
    public body?: string,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

// ---- Client ----

export interface DeepSeekClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 300_000;

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: DeepSeekClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static fromEnv(): DeepSeekClient {
    let apiKey = process.env["DEEPSEEK_API_KEY"];

    // Fallback: read from .dsh/config.yml
    if (!apiKey) {
      try {
        const configPath = path.join(process.cwd(), ".dsh", "config.yml");
        const config = fs.readFileSync(configPath, "utf-8");
        const match = config.match(/^\s*api_key:\s*["']?([^"'\n]+)["']?\s*$/m);
        if (match && match[1]) apiKey = match[1];
      } catch {
        // config file not found or unreadable, fall through
      }
    }

    if (!apiKey) {
      throw new DeepSeekError(
        "DEEPSEEK_API_KEY environment variable is not set",
      );
    }
    return new DeepSeekClient({
      apiKey,
      baseUrl: process.env["DEEPSEEK_BASE_URL"],
    });
  }

  async chat(
    req: DeepSeekRequest,
    signal?: AbortSignal,
  ): Promise<DeepSeekResponse> {
    const body = this.buildRequestBody(req);
    const headers = this.buildHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new DeepSeekError(
          `DeepSeek API error ${res.status}: ${res.statusText}`,
          res.status,
          errorBody,
        );
      }

      const json = (await res.json()) as DeepSeekResponse;
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
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new DeepSeekError(
          `DeepSeek API error ${res.status}: ${res.statusText}`,
          res.status,
          errorBody,
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

  private buildRequestBody(req: DeepSeekRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };

    if (req.thinking !== undefined) {
      // DeepSeek requires chat_completion_reasoning_effort for thinking mode
      // Setting to "high" enables deep reasoning; omit to disable
      body["chat_completion_reasoning_effort"] = req.thinking
        ? "high"
        : "disabled";
    }

    if (req.max_tokens !== undefined) body["max_tokens"] = req.max_tokens;
    if (req.temperature !== undefined) body["temperature"] = req.temperature;
    if (req.stream !== undefined) body["stream"] = req.stream;

    return body;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "Accept": "application/json",
    };
  }
}
