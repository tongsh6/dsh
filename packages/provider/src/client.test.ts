import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DeepSeekApiError, DeepSeekClient, DeepSeekError } from "./client.js";

describe("DeepSeekClient", () => {
  let client: DeepSeekClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new DeepSeekClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("fromEnv", () => {
    it("reads DEEPSEEK_API_KEY from environment", () => {
      process.env["DEEPSEEK_API_KEY"] = "env-key";
      const c = DeepSeekClient.fromEnv();
      assert.ok(c instanceof DeepSeekClient);
      delete process.env["DEEPSEEK_API_KEY"];
    });

    it("throws when DEEPSEEK_API_KEY is not set", () => {
      delete process.env["DEEPSEEK_API_KEY"];
      assert.throws(() => DeepSeekClient.fromEnv(), DeepSeekError);
    });
  });

  describe("chat", () => {
    it("uses the official chat completion endpoint by default", async () => {
      let capturedUrl = "";

      globalThis.fetch = ((url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = String(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Hi" }],
      });

      assert.equal(capturedUrl, "https://api.deepseek.com/chat/completions");
    });

    it("can opt into the legacy OpenAI-compatible v1 endpoint", async () => {
      let capturedUrl = "";
      const v1Client = new DeepSeekClient({
        apiKey: "test-key",
        endpointMode: "openai-compatible-v1",
      });

      globalThis.fetch = ((url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = String(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await v1Client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Hi" }],
      });

      assert.equal(capturedUrl, "https://api.deepseek.com/v1/chat/completions");
    });

    it("sends correct request body with thinking enabled", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              object: "chat.completion",
              created: Date.now(),
              model: "deepseek-v4-pro",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "Hello!" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      const res = await client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Hi" }],
        thinking: true,
      });

      const parsed = JSON.parse(capturedBody!);
      assert.equal(parsed["model"], "deepseek-v4-pro");
      assert.equal(parsed["messages"][0].content, "Hi");
      assert.equal(parsed["thinking"].type, "enabled");
      assert.equal(parsed["reasoning_effort"], "high");
      assert.equal(parsed["chat_completion_reasoning_effort"], undefined);
      assert.equal(res.choices[0]?.message.content, "Hello!");
    });

    it("sends thinking=disabled when thinking is false", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "OK" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await client.chat({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "test" }],
        thinking: false,
      });

      const parsed = JSON.parse(capturedBody!);
      assert.equal(parsed["thinking"].type, "disabled");
      assert.equal(parsed["reasoning_effort"], undefined);
    });

    it("sends reasoning_effort=max when requested", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "test" }],
        thinking: true,
        reasoningEffort: "max",
      });

      const parsed = JSON.parse(capturedBody!);
      assert.equal(parsed["reasoning_effort"], "max");
    });

    it("removes sampling parameters when thinking is enabled", async () => {
      let capturedBody: string | null = null;
      const originalWarn = console.warn;
      console.warn = () => {};

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      try {
        await client.chat({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "test" }],
          thinking: true,
          temperature: 0.2,
          top_p: 0.9,
          presence_penalty: 0.1,
          frequency_penalty: 0.1,
          logprobs: true,
          top_logprobs: 2,
        });
      } finally {
        console.warn = originalWarn;
      }

      const parsed = JSON.parse(capturedBody!);
      assert.equal(parsed["temperature"], undefined);
      assert.equal(parsed["top_p"], undefined);
      assert.equal(parsed["presence_penalty"], undefined);
      assert.equal(parsed["frequency_penalty"], undefined);
      assert.equal(parsed["logprobs"], undefined);
      assert.equal(parsed["top_logprobs"], undefined);
    });

    it("throws DeepSeekApiError on non-retryable HTTP error", async () => {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response('{"error":"bad request"}', { status: 400 }),
        )) as typeof globalThis.fetch;

      await assert.rejects(
        () =>
          new DeepSeekClient({ apiKey: "test-key", retryOptions: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } }).chat({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: "err" }],
          }),
        (e: unknown) => {
          return (
            e instanceof DeepSeekApiError &&
            e.status === 400 &&
            e.message.includes("400") &&
            e.retryable === false &&
            e.attempt === 1 &&
            (e.durationMs ?? -1) >= 0
          );
        },
      );
    });

    for (const status of [400, 401, 402, 422]) {
      it(`does not retry HTTP ${status}`, async () => {
        let calls = 0;
        globalThis.fetch = (() => {
          calls++;
          return Promise.resolve(
            new Response(JSON.stringify({ error: `status ${status}` }), { status }),
          );
        }) as typeof globalThis.fetch;

        await assert.rejects(
          () =>
            new DeepSeekClient({ apiKey: "test-key", retryOptions: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 } }).chat({
              model: "deepseek-v4-pro",
              messages: [{ role: "user", content: "err" }],
            }),
          DeepSeekApiError,
        );
        assert.equal(calls, 1);
      });
    }

    for (const status of [429, 500, 503]) {
      it(`retries HTTP ${status}`, async () => {
        let calls = 0;
        const retryClient = new DeepSeekClient({
          apiKey: "test-key",
          retryOptions: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 },
        });
        const originalWarn = console.warn;
        console.warn = () => {};
        globalThis.fetch = (() => {
          calls++;
          return Promise.resolve(
            calls < 3
              ? new Response(JSON.stringify({ error: `status ${status}` }), { status })
              : new Response(
                  JSON.stringify({
                    id: "resp-1",
                    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                  }),
                  { status: 200 },
                ),
          );
        }) as typeof globalThis.fetch;

        try {
          const res = await retryClient.chat({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: "retry" }],
          });
          assert.equal(res.choices[0]?.message.content, "OK");
          assert.equal(calls, 3);
        } finally {
          console.warn = originalWarn;
        }
      });
    }

    it("throws DeepSeekApiError after max retries and preserves body", async () => {
      const retryClient = new DeepSeekClient({
        apiKey: "test-key",
        retryOptions: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      });
      const originalWarn = console.warn;
      console.warn = () => {};
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "overloaded" }), { status: 503 }),
        )) as typeof globalThis.fetch;

      try {
        await assert.rejects(
          () =>
            retryClient.chat({
              model: "deepseek-v4-pro",
              messages: [{ role: "user", content: "err" }],
            }),
          (e: unknown) =>
            e instanceof DeepSeekApiError &&
            e.status === 503 &&
            e.retryable === true &&
            e.attempt === 2 &&
            (e.durationMs ?? -1) >= 0 &&
            JSON.stringify(e.body).includes("overloaded"),
        );
      } finally {
        console.warn = originalWarn;
      }
    });

    it("passes tools in request body when provided", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{
                index: 0,
                message: { role: "assistant", content: "OK" },
                finish_reason: "stop",
              }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      const tools = [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      }];

      await client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "test" }],
        tools,
      });

      const parsed = JSON.parse(capturedBody!);
      assert.deepEqual(parsed["tools"], tools);
    });

    it("supports JSON output response_format", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "json" }],
        responseFormat: { type: "json_object" },
      });

      const parsed = JSON.parse(capturedBody!);
      assert.equal(parsed["response_format"].type, "json_object");
    });

    it("requires beta configuration for strict tool calls", async () => {
      await assert.rejects(
        () =>
          client.chat({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: "test" }],
            tools: [{
              type: "function",
              function: {
                name: "read_file",
                strict: true,
                parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
              },
            }],
          }),
        /strict tool calls/,
      );
    });

    it("sends strict tool schema when beta flag is enabled", async () => {
      let capturedBody: string | null = null;
      const strictClient = new DeepSeekClient({
        apiKey: "test-key",
        betaBaseUrl: "https://api.deepseek.com/beta",
        featureFlags: { strictToolCalls: true },
      });

      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        assert.ok(init);
        capturedBody = init.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await strictClient.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "test" }],
        tools: [{
          type: "function",
          function: {
            name: "read_file",
            strict: true,
            parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
          },
        }],
      });

      const parsed = JSON.parse(capturedBody!);
      assert.equal(parsed.tools[0].function.strict, true);
    });

    it("uses beta chat endpoint for chat prefix when enabled", async () => {
      let capturedUrl = "";
      const prefixClient = new DeepSeekClient({
        apiKey: "test-key",
        betaBaseUrl: "https://api.deepseek.com/beta",
        featureFlags: { chatPrefix: true },
      });

      globalThis.fetch = ((url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = String(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      await prefixClient.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "assistant", content: "```xml\n<PATCH>\n", prefix: true }],
      });

      assert.equal(capturedUrl, "https://api.deepseek.com/beta/chat/completions");
    });

    it("parses tool_calls from response", async () => {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{
                index: 0,
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"src/foo.ts"}',
                    },
                  }],
                },
                finish_reason: "tool_calls",
              }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }),
            { status: 200 },
          ),
        )) as typeof globalThis.fetch;

      const res = await client.chat({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "read the file" }],
        tools: [],
      });

      const toolCalls = res.choices[0]?.message.tool_calls;
      assert.ok(toolCalls);
      assert.equal(toolCalls![0]!.function.name, "read_file");
      assert.equal(toolCalls![0]!.function.arguments, '{"path":"src/foo.ts"}');
    });

    it("clears both request and body-read timeouts after a successful response", async () => {
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const timeoutIds: unknown[] = [];
      const clearedIds: unknown[] = [];

      globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const id = originalSetTimeout(handler, timeout, ...args);
        timeoutIds.push(id);
        return id;
      }) as typeof globalThis.setTimeout;
      globalThis.clearTimeout = ((id?: number | NodeJS.Timeout) => {
        clearedIds.push(id);
        return originalClearTimeout(id);
      }) as typeof globalThis.clearTimeout;

      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp-1",
              choices: [{
                index: 0,
                message: { role: "assistant", content: "OK" },
                finish_reason: "stop",
              }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        )) as typeof globalThis.fetch;

      try {
        await client.chat({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "test" }],
        });
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
      }

      assert.equal(timeoutIds.length, 2);
      assert.equal(clearedIds.length, 2);
      assert.deepEqual(new Set(clearedIds), new Set(timeoutIds));
    });

    it("supports FIM through a separate feature-flagged endpoint", async () => {
      let capturedUrl = "";
      let capturedBody: string | null = null;
      const fimClient = new DeepSeekClient({
        apiKey: "test-key",
        betaBaseUrl: "https://api.deepseek.com/beta",
        featureFlags: { fim: true },
      });

      globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = init?.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ text: "completion" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
            { status: 200 },
          ),
        );
      }) as typeof globalThis.fetch;

      const res = await fimClient.fim({
        model: "deepseek-v4-pro",
        prompt: "function a() {",
        suffix: "}",
        maxTokens: 20,
      });

      const parsed = JSON.parse(capturedBody!);
      assert.equal(capturedUrl, "https://api.deepseek.com/beta/completions");
      assert.equal(parsed.max_tokens, 20);
      assert.equal(res.content, "completion");
    });
  });

  describe("chatStream", () => {
    it("yields parsed stream chunks", async () => {
      const streamBody = [
        'data: {"id":"s1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n',
        'data: {"id":"s1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n',
        "data: [DONE]\n",
      ].join("");

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(streamBody));
          controller.close();
        },
      });

      globalThis.fetch = (() =>
        Promise.resolve(new Response(stream, { status: 200 }))) as typeof globalThis.fetch;

      const chunks: string[] = [];
      for await (const chunk of client.chatStream({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "say hello" }],
      })) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) chunks.push(content);
      }

      assert.equal(chunks.join(""), "Hello world");
    });

    it("yields reasoning_content stream deltas", async () => {
      const streamBody = [
        'data: {"id":"s1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"reasoning_content":"Think"},"finish_reason":null}]}\n',
        "data: [DONE]\n",
      ].join("");

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(streamBody));
          controller.close();
        },
      });

      globalThis.fetch = (() =>
        Promise.resolve(new Response(stream, { status: 200 }))) as typeof globalThis.fetch;

      const chunks: string[] = [];
      for await (const chunk of client.chatStream({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "think" }],
      })) {
        const content = chunk.choices[0]?.delta?.reasoning_content;
        if (content) chunks.push(content);
      }

      assert.equal(chunks.join(""), "Think");
    });
  });
});
