import assert from "node:assert/strict";
import { test } from "node:test";
import { createPermissionMiddleware, ToolRegistry } from "../src/index.js";
import type { AgentTool } from "../src/index.js";

function dummyTool(name: string): AgentTool<Record<string, never>, { ok: true }> {
  return {
    name,
    description: `${name} dummy`,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: () => ({ content: [{ type: "text", text: "ok" }], details: { ok: true } }),
  };
}

test("readonly role denies write/edit/backtest and returns permission denied", async () => {
  const registry = new ToolRegistry({ permission: createPermissionMiddleware("readonly"), permissionRole: "readonly" });
  registry.register(dummyTool("write"));
  registry.register(dummyTool("edit"));
  registry.register(dummyTool("backtest"));

  for (const name of ["write", "edit", "backtest"]) {
    const result = await registry.execute({ id: `call-${name}`, name, arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.error ?? "", /permission denied/);
  }
});

test("backtest role allows backtest but cannot escalate to write/edit", async () => {
  const registry = new ToolRegistry({ permission: createPermissionMiddleware("backtest"), permissionRole: "backtest" });
  registry.register(dummyTool("backtest"));
  registry.register(dummyTool("write"));
  registry.register(dummyTool("edit"));

  const allowed = await registry.execute({ id: "call-backtest", name: "backtest", arguments: {} });
  assert.equal(allowed.isError, false);

  for (const name of ["write", "edit"]) {
    const result = await registry.execute({ id: `call-${name}`, name, arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.error ?? "", /permission denied/);
  }
});
