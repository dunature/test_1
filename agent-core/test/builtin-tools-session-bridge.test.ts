import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentEventHub, AgentSession, createBridgeServer, createDefaultResourceOperations, createEditTool, createFetchDataTool, createLoadResourceTool, createNodeFileOperations, createReadTool, createTushareOperations, createWriteTool, JsonlSessionTree, ToolRegistry, WebSocketClient } from "../src/index.js";

test("read/edit/write tools support pagination, exact replacement, parent mkdir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-files-"));
  try {
    const ops = createNodeFileOperations(dir);
    const registry = new ToolRegistry();
    registry.register(createWriteTool(ops)); registry.register(createReadTool(ops)); registry.register(createEditTool(ops));
    await registry.execute({ id: "w", name: "write", arguments: { path: "a/b.txt", content: "one\ntwo\nthree" } });
    const read = await registry.execute({ id: "r", name: "read", arguments: { path: "a/b.txt", offset: 2, limit: 1 } });
    assert.match(read.result?.content[0]?.type === "text" ? read.result.content[0].text : "", /2: two/);
    const edit = await registry.execute({ id: "e", name: "edit", arguments: { path: "a/b.txt", oldText: "two", newText: "TWO" } });
    assert.equal(edit.isError, false);
    assert.match(await readFile(join(dir, "a/b.txt"), "utf8"), /TWO/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("read/write tools reject paths outside the workspace root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-files-safe-"));
  const outside = join(dir, "..", "outside.txt");
  try {
    await writeFile(outside, "secret", "utf8");
    const ops = createNodeFileOperations(dir);
    const registry = new ToolRegistry();
    registry.register(createReadTool(ops)); registry.register(createWriteTool(ops));

    const read = await registry.execute({ id: "r", name: "read", arguments: { path: "../outside.txt" } });
    assert.equal(read.isError, true);
    assert.match(read.error ?? "", /escapes root/);

    const write = await registry.execute({ id: "w", name: "write", arguments: { path: outside, content: "changed" } });
    assert.equal(write.isError, true);
    assert.match(write.error ?? "", /escapes root/);
    assert.equal(await readFile(outside, "utf8"), "secret");
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { force: true }); }
});

test("fetch_data uses replaceable provider operations and offset truncation", async () => {
  const tool = createFetchDataTool({ fetchMinuteBars: async () => [{ ts_code: "A", close: 1 }, { ts_code: "A", close: 2 }, { ts_code: "A", close: 3 }] });
  const registry = new ToolRegistry(); registry.register(tool);
  const result = await registry.execute({ id: "f", name: "fetch_data", arguments: { symbol: "A", start_date: "20240101", end_date: "20240102", fields: ["close"], limit: 2 } });
  assert.equal(result.result?.details && (result.result.details as any).truncated, true);
  assert.match(result.result?.content[0]?.type === "text" ? result.result.content[0].text : "", /offset=2/);
});

test("Tushare operations use stk_mins for minute bars", async () => {
  let requestBody: any;
  const operations = createTushareOperations("test-token", async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      code: 0,
      data: {
        fields: ["ts_code", "trade_time", "open", "close"],
        items: [["600519.SH", "20240524093000", 1, 2]],
      },
    }));
  });

  const rows = await operations.fetchMinuteBars({
    symbol: "600519.SH",
    start_date: "20240520",
    end_date: "20240524",
    data_source: "tushare",
    freq: "1min",
    offset: 0,
    limit: 200,
  });

  assert.equal(requestBody.api_name, "stk_mins");
  assert.equal(requestBody.params.freq, "1min");
  assert.deepEqual(rows, [{ ts_code: "600519.SH", trade_time: "20240524093000", open: 1, close: 2 }]);
});

test("load_resource returns metadata and preview for files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-res-"));
  try {
    await writeFile(join(dir, "note.md"), "# title\nbody", "utf8");
    const registry = new ToolRegistry(); registry.register(createLoadResourceTool({ load: async (params) => ({ metadata: { id: "x", source: params.source, uri: params.uri, name: "note.md", size: 12, sha256: "abc", summary: "# title" }, contentPreview: "# title" }) }));
    const result = await registry.execute({ id: "l", name: "load_resource", arguments: { source: "file", uri: "note.md" } });
    assert.equal((result.result?.details as any).summary, "# title");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("load_resource rejects file paths outside the workspace root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-res-safe-"));
  try {
    const registry = new ToolRegistry();
    registry.register(createLoadResourceTool(createDefaultResourceOperations(dir)));
    const result = await registry.execute({ id: "l", name: "load_resource", arguments: { source: "file", uri: "../secret.txt" } });
    assert.equal(result.isError, true);
    assert.match(result.error ?? "", /escapes root/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("JsonlSessionTree rebuilds context, moves leaf, forks and clones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-"));
  try {
    const tree = await JsonlSessionTree.open(join(dir, "s.jsonl"));
    const a = await tree.appendMessage({ role: "user", content: "root" });
    const b = await tree.appendMessage({ role: "assistant", content: "branch-a" });
    await tree.tree(a.id);
    const c = await tree.appendMessage({ role: "assistant", content: "branch-b" });
    assert.deepEqual(tree.buildSessionContext(c.id).map((m) => m.content), ["root", "branch-b"]);
    assert.deepEqual(tree.buildSessionContext(b.id).map((m) => m.content), ["root", "branch-a"]);
    const cloned = await tree.clone(join(dir, "clone.jsonl"), c.id);
    assert.deepEqual(cloned.buildSessionContext().map((m) => m.content), ["root", "branch-b"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("createBridgeServer serves UI and accepts AgentEventHub construction", async () => {
  const hub = new AgentEventHub();
  const server = createBridgeServer(hub, { staticDir: join(process.cwd(), "public") });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.equal(typeof address === "object" && address !== null && address.port > 0, true);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("createBridgeServer exposes health check with uptime", async () => {
  const hub = new AgentEventHub();
  const server = createBridgeServer(hub, { staticDir: join(process.cwd(), "public"), startedAt: Date.now() - 1500 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(typeof address === "object" && address !== null);
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; uptime_seconds: number; active_ws_clients: number; attached_sessions: number };
  assert.equal(body.status, "ok");
  assert.equal(body.uptime_seconds >= 1, true);
  assert.equal(body.active_ws_clients, 0);
  assert.equal(body.attached_sessions, 0);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("createBridgeServer rejects static path traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-static-"));
  try {
    const publicDir = join(dir, "public");
    await writeFile(join(dir, "secret.txt"), "secret", "utf8");
    await writeFile(join(publicDir, "index.html"), "ok", "utf8").catch(async (error: any) => {
      if (error?.code !== "ENOENT") throw error;
      await import("node:fs/promises").then(({ mkdir }) => mkdir(publicDir, { recursive: true }));
      await writeFile(join(publicDir, "index.html"), "ok", "utf8");
    });
    const hub = new AgentEventHub();
    const server = createBridgeServer(hub, { staticDir: publicDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(typeof address === "object" && address !== null);
    const response = await fetch(`http://127.0.0.1:${address.port}/..%2Fsecret.txt`);
    assert.equal(response.status, 404);
    assert.notEqual(await response.text(), "secret");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("WebSocketClient parses inbound masked text frames and routes messages", async () => {
  const socket = new FakeSocket();
  let resolveMessage!: (text: string) => void;
  const received = new Promise<string>((resolve) => { resolveMessage = resolve; });
  const client = new WebSocketClient(socket as any);
  client.onMessage = (raw) => resolveMessage((JSON.parse(raw) as { text: string }).text);
  socket.emit("data", maskedClientTextFrame(JSON.stringify({ type: "message", text: "run agent" })));
  assert.equal(await received, "run agent");
});

test("WebSocketClient encodes large outbound text frames with 64-bit length", () => {
  const socket = new FakeSocket();
  const client = new WebSocketClient(socket as any);
  const text = "x".repeat(70_000);
  client.sendText(text);

  const frame = socket.writes[0]!;
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 127);
  assert.equal(Number(frame.readBigUInt64BE(2)), Buffer.byteLength(text));
  assert.equal(frame.subarray(10).toString("utf8"), text);
});

test("AgentEventHub creates one server-side session per WebSocket client", () => {
  const hub = new AgentEventHub();
  const a = new WebSocketClient(new FakeSocket() as any);
  const b = new WebSocketClient(new FakeSocket() as any);
  const makeSession = (client: WebSocketClient) => new AgentSession({ provider: {} as any, model: {} as any, auth: {}, sessionId: client.sessionId });

  const a1 = hub.getOrCreateClientSession(a, makeSession);
  const a2 = hub.getOrCreateClientSession(a, makeSession);
  const b1 = hub.getOrCreateClientSession(b, makeSession);

  assert.equal(a1, a2);
  assert.notEqual(a1.sessionId, b1.sessionId);
  assert.equal(a1.sessionId, a.sessionId);
  assert.equal(b1.sessionId, b.sessionId);
  assert.equal(hub.sessionCount(), 2);
});

function maskedClientTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]!));
  return Buffer.concat([header, mask, masked]);
}

class FakeSocket extends EventEmitter {
  writes: Buffer[] = [];
  write(chunk: Buffer): void { this.writes.push(chunk); }
  end(): void { this.emit("close"); }
  destroy(): void { this.emit("close"); }
}
