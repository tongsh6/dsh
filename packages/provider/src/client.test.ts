import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DeepSeekClient, DeepSeekError } from "./client.js";

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
    it("sends correct request body with thinking enabled", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((url: string, init: RequestInit) => {
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
      assert.equal(parsed["chat_completion_reasoning_effort"], "high");
      assert.equal(res.choices[0]?.message.content, "Hello!");
    });

    it("sends thinking=disabled when thinking is false", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((url: string, init: RequestInit) => {
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
      assert.equal(parsed["chat_completion_reasoning_effort"], "disabled");
    });

    it("throws DeepSeekError on HTTP error", async () => {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response('{"error":"bad request"}', { status: 400 }),
        )) as typeof globalThis.fetch;

      await assert.rejects(
        () =>
          client.chat({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: "err" }],
          }),
        (e: unknown) => {
          return (
            e instanceof DeepSeekError &&
            e.status === 400 &&
            e.message.includes("400")
          );
        },
      );
    });

    it("passes tools in request body when provided", async () => {
      let capturedBody: string | null = null;

      globalThis.fetch = ((url: string, init: RequestInit) => {
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
  });
});
