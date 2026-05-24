import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession, ToolRegistry, type ModelDescriptor, type ProviderAdapter, type StreamRequest, type StreamEvent } from "../src/index.js";

const model: ModelDescriptor = {
  provider: "fake",
  id: "fake-model",
  name: "Fake Model",
  api: "openai-compatible",
  baseUrl: "http://fake/v1",
  contextWindow: 128000,
  maxOutputTokens: 4096,
  input: ["text"],
  supportsTools: true,
};

class ScriptedProvider implements ProviderAdapter {
  readonly id = "fake";
  calls: StreamRequest[] = [];
  constructor(private readonly scripts: StreamEvent[][]) {}
  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    this.calls.push(request);
    const script = this.scripts.shift();
    if (!script) throw new Error("no scripted response");
    for (const event of script) yield event;
  }
}

test("AgentSession runs assistant -> tool -> result -> next turn and emits events", async () => {
  const provider = new ScriptedProvider([
    [
      { type: "message_start", provider: "fake", model: "fake-model" },
      { type: "tool_call_delta", index: 0, id: "call-1", name: "lookup", argumentsDelta: '{"symbol":"' },
      { type: "tool_call_delta", index: 0, argumentsDelta: '000001.SZ"}' },
      { type: "message_stop", finishReason: "tool_calls" },
    ],
    [
      { type: "message_start", provider: "fake", model: "fake-model" },
      { type: "content_delta", delta: "平安银行" },
      { type: "message_stop", finishReason: "stop" },
    ],
  ]);

  const tools = new ToolRegistry();
  tools.register<{ symbol: string }, { source: string }, { lookup(symbol: string): string }>({
    name: "lookup",
    description: "Lookup symbol",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
      additionalProperties: false,
    },
    operations: { lookup: (symbol) => `name:${symbol}` },
    execute: ({ params, operations }) => ({
      content: [{ type: "text", text: operations!.lookup(params.symbol) }],
      details: { source: "fixture" },
    }),
  });

  const session = new AgentSession({ provider, model, auth: {}, tools, sessionId: "s1", maxTurns: 4 });
  const seen: string[] = [];
  session.subscribe((event) => { seen.push(event.type); });
  const result = await session.run("查一下 000001.SZ");

  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]!.tools?.[0]?.name, "lookup");
  assert.equal(result.messages.at(-1)?.content, "平安银行");
  assert.equal(result.messages.some((message) => message.role === "tool" && message.content === "name:000001.SZ"), true);
  assert.deepEqual(seen.filter((type) => type === "tool_execution_start" || type === "tool_execution_end"), ["tool_execution_start", "tool_execution_end"]);
  assert.equal(result.events[0]?.type, "agent_start");
  assert.equal(result.events.at(-1)?.type, "agent_end");
});

test("AgentSession records tool execution errors as tool result messages", async () => {
  const provider = new ScriptedProvider([
    [
      { type: "message_start", provider: "fake", model: "fake-model" },
      { type: "tool_call_delta", index: 0, id: "call-1", name: "missing", argumentsDelta: "{}" },
      { type: "message_stop", finishReason: "tool_calls" },
    ],
    [
      { type: "message_start", provider: "fake", model: "fake-model" },
      { type: "content_delta", delta: "已处理错误" },
      { type: "message_stop", finishReason: "stop" },
    ],
  ]);
  const session = new AgentSession({ provider, model, auth: {}, tools: new ToolRegistry(), sessionId: "s2" });
  const result = await session.run("call missing");
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.match(toolMessage?.content ?? "", /Unknown tool: missing/);
});
