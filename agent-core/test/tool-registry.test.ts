import assert from "node:assert/strict";
import { test } from "node:test";
import { defineTool, ToolRegistry } from "../src/index.js";

test("ToolRegistry exposes registered tools as model function definitions", () => {
  const registry = new ToolRegistry();
  registry.register(defineTool<{ text: string }, { echoed: boolean }>({
    name: "echo",
    description: "Echo text",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: ({ params }) => ({ content: [{ type: "text", text: params.text }], details: { echoed: true } }),
  }));

  assert.deepEqual(registry.toModelTools(), [{
    type: "function",
    function: {
      name: "echo",
      description: "Echo text",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  }]);
});

test("ToolRegistry validates arguments and returns structured details", async () => {
  const registry = new ToolRegistry();
  registry.register(defineTool<{ a: number; b: number }, { value: number }>({
    name: "sum",
    description: "Sum two numbers",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
      additionalProperties: false,
    },
    details: { category: "math" },
    execute: ({ params }) => ({
      content: [{ type: "text", text: String(params.a + params.b) }],
      details: { value: params.a + params.b },
    }),
  }));

  const ok = await registry.execute<{ value: number }>({ id: "call-1", name: "sum", arguments: { a: 2, b: 3 } });
  assert.equal(ok.isError, false);
  assert.deepEqual(ok.result?.details, { value: 5 });

  const bad = await registry.execute({ id: "call-2", name: "sum", arguments: { a: 2 } });
  assert.equal(bad.isError, true);
  assert.match(bad.error ?? "", /missing required argument: b/);
});

test("ToolRegistry supports replaceable operations and controlled output truncation", async () => {
  const registry = new ToolRegistry({ maxTextResultChars: 5 });
  registry.register(defineTool<{ path: string }, { path: string }, { read(path: string): string }>({
    name: "read",
    description: "Read a resource",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    operations: { read: (path: string) => `content:${path}` },
    renderCall: (params) => `read ${params.path}`,
    renderResult: (result) => result.content.map((item) => item.type === "text" ? item.text : "[image]").join("\n"),
    execute: ({ params, operations }) => ({
      content: [{ type: "text", text: operations!.read(params.path) }],
      details: { path: params.path },
    }),
  }));

  const record = await registry.execute({ id: "call-1", name: "read", arguments: { path: "alpha" } });
  assert.equal(record.isError, false);
  assert.match(record.result?.content[0]?.type === "text" ? record.result.content[0].text : "", /truncated at 5 chars/);
  assert.deepEqual(record.result?.details, { path: "alpha" });
});
