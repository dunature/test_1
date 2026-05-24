import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthStorage, ModelRegistry, OpenAICompatibleAdapter } from "../src/index.js";
import type { ModelDescriptor } from "../src/index.js";

const encoder = new TextEncoder();

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

test("AuthStorage resolves runtime keys before stored and env credentials", () => {
  const auth = AuthStorage.inMemory({ openai: { type: "api_key", key: "stored" } });
  auth.setRuntimeApiKey("openai", "runtime");
  assert.equal(auth.getApiKey("openai"), "runtime");
});

test("ModelRegistry registers OpenAI-compatible models and resolves auth+headers", async () => {
  const auth = AuthStorage.inMemory();
  auth.setRuntimeApiKey("test-provider", "test-key");
  const registry = ModelRegistry.inMemory(auth, {
    providers: {
      "test-provider": {
        baseUrl: "https://llm.example/v1/",
        headers: { "x-provider": "provider" },
        models: [{ id: "model-a", headers: { "x-model": "model" } }],
      },
    },
  });

  const model = registry.find("test-provider", "model-a");
  assert.ok(model);
  assert.equal(model.baseUrl, "https://llm.example/v1");

  const authResult = await registry.getAuthForModel(model);
  assert.deepEqual(authResult, {
    ok: true,
    auth: { apiKey: "test-key", headers: { "x-provider": "provider", "x-model": "model" } },
  });
});

test("ModelRegistry resolves auth through fallback resolver for provider requests", async () => {
  const auth = AuthStorage.inMemory();
  auth.setFallbackResolver((provider) => (provider === "deepseek" ? "vault-key" : undefined));
  const registry = ModelRegistry.inMemory(auth, {
    providers: {
      deepseek: {
        baseUrl: "https://api.deepseek.com",
        models: [{ id: "deepseek-v4-pro" }],
      },
    },
  });

  const model = registry.find("deepseek", "deepseek-v4-pro");
  assert.ok(model);
  assert.equal(auth.hasAuth("deepseek"), true);

  const authResult = await registry.getAuthForModel(model);
  assert.deepEqual(authResult, { ok: true, auth: { apiKey: "vault-key" } });
});

test("OpenAICompatibleAdapter converts SSE streaming chunks to normalized events", async () => {
  let capturedBody: unknown;
  let capturedHeaders: Headers;
  const model: ModelDescriptor = {
    provider: "openai",
    id: "gpt-test",
    name: "GPT Test",
    api: "openai-compatible",
    baseUrl: "https://api.example/v1",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    input: ["text"],
    supportsTools: true,
  };

  const fetchMock = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    capturedBody = JSON.parse(String(init?.body));
    capturedHeaders = new Headers(init?.headers);
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      "data: [DONE]\n\n",
    ]);
  };

  const adapter = new OpenAICompatibleAdapter("openai", fetchMock);
  const events = [];
  for await (const event of adapter.stream({
    model,
    auth: { apiKey: "secret", headers: { "x-custom": "yes" } },
    messages: [{ role: "user", content: "hi" }],
  })) {
    events.push(event);
  }

  assert.equal(capturedHeaders!.get("authorization"), "Bearer secret");
  assert.equal(capturedHeaders!.get("x-custom"), "yes");
  assert.equal((capturedBody as { stream: boolean }).stream, true);
  assert.deepEqual(events, [
    { type: "message_start", provider: "openai", model: "gpt-test" },
    { type: "content_delta", delta: "hel" },
    { type: "content_delta", delta: "lo" },
    { type: "message_stop", finishReason: "stop", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
  ]);
});

test("OpenAICompatibleAdapter parses CRLF-delimited SSE events", async () => {
  const model: ModelDescriptor = {
    provider: "deepseek",
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    input: ["text"],
    supportsTools: true,
  };

  const fetchMock = async (): Promise<Response> =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\r\n\r\n',
      "data: [DONE]\r\n\r\n",
    ]);

  const adapter = new OpenAICompatibleAdapter("deepseek", fetchMock);
  const events = [];
  for await (const event of adapter.stream({
    model,
    auth: { apiKey: "secret" },
    messages: [{ role: "user", content: "hi" }],
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "message_start", provider: "deepseek", model: "deepseek-v4-pro" },
    { type: "content_delta", delta: "hel" },
    { type: "content_delta", delta: "lo" },
    { type: "message_stop", finishReason: "stop" },
  ]);
});
