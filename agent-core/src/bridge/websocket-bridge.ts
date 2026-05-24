import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeResolve } from "../safe-path.js";
import type { AgentEvent, AgentSession } from "../agent/index.js";
import { JsonlSessionTree } from "../session-tree/index.js";

export interface SessionApi { create(): Promise<string>; tree(sessionId: string, leafId: string): Promise<void>; fork(sessionId: string, entryId: string): Promise<string>; clone(sessionId: string): Promise<string> }
export interface ClientCommand { type: "message" | "tree" | "fork" | "clone"; text?: string; sessionId?: string; leafId?: string; entryId?: string }
export interface BridgeOptions { staticDir?: string; sessionDir?: string; sessionApi?: SessionApi; onClientMessage?: (message: ClientCommand, client: WebSocketClient) => void | Promise<void> }

export class AgentEventHub {
  private clients = new Set<WebSocketClient>();
  private sessions = new Set<AgentSession>();
  attach(session: AgentSession): void { this.sessions.add(session); session.subscribe((event) => this.broadcast(event)); }
  add(client: WebSocketClient): void { this.clients.add(client); client.onClose = () => this.clients.delete(client); }
  broadcast(event: AgentEvent): void { for (const client of this.clients) client.sendJson(event); }
  async runMessage(text: string): Promise<void> {
    const session = this.sessions.values().next().value;
    if (!session) throw new Error("No agent session attached");
    await session.run(text);
  }
}

export class WebSocketClient {
  onClose?: () => void;
  onMessage?: (text: string) => void | Promise<void>;
  private buffer = Buffer.alloc(0);
  constructor(private readonly socket: Socket) {
    socket.on("close", () => this.onClose?.());
    socket.on("data", (chunk) => this.readFrames(chunk));
  }
  sendJson(value: unknown): void { this.sendText(JSON.stringify(value)); }
  sendText(text: string): void {
    const payload = Buffer.from(text);
    const header = createTextFrameHeader(payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }
  private readFrames(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0]!;
      const second = this.buffer[1]!;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const bigLength = this.buffer.readBigUInt64BE(2);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.socket.destroy();
          return;
        }
        length = Number(bigLength);
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const mask = masked ? this.buffer.subarray(maskOffset, maskOffset + 4) : undefined;
      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x8) {
        this.socket.end();
        return;
      }
      if (opcode !== 0x1) continue;
      if (mask) payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]!));
      void this.onMessage?.(payload.toString("utf8"));
    }
  }
}

function createTextFrameHeader(payloadLength: number): Buffer {
  if (payloadLength < 126) return Buffer.from([0x81, payloadLength]);
  if (payloadLength < 65_536) return Buffer.from([0x81, 126, payloadLength >> 8, payloadLength & 0xff]);
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return header;
}

export function createBridgeServer(hub: AgentEventHub, options: BridgeOptions = {}): Server {
  const staticDir = options.staticDir ?? join(process.cwd(), "public");
  const server = createServer(async (req, res) => serveHttp(req, res, staticDir));
  server.on("upgrade", (req, socket) => {
    if (req.headers.upgrade?.toLowerCase() !== "websocket") return socket.destroy();
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") return socket.destroy();
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
    const client = new WebSocketClient(socket as Socket);
    client.onMessage = (raw) => handleClientMessage(hub, options, client, raw);
    hub.add(client);
  });
  return server;
}

export function createSessionApi(sessionDir: string): SessionApi {
  return {
    async create() { const id = crypto.randomUUID(); await JsonlSessionTree.open(join(sessionDir, `${id}.jsonl`)); return id; },
    async tree(sessionId, leafId) { const tree = await JsonlSessionTree.open(join(sessionDir, `${sessionId}.jsonl`)); await tree.tree(leafId); },
    async fork(sessionId, entryId) { const tree = await JsonlSessionTree.open(join(sessionDir, `${sessionId}.jsonl`)); await tree.fork(entryId); return sessionId; },
    async clone(sessionId) { const tree = await JsonlSessionTree.open(join(sessionDir, `${sessionId}.jsonl`)); const id = crypto.randomUUID(); await tree.clone(join(sessionDir, `${id}.jsonl`)); return id; },
  };
}

async function serveHttp(req: IncomingMessage, res: ServerResponse, staticDir: string): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const file = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const content = await readFile(safeResolve(staticDir, file, "static file"));
    res.writeHead(200, { "content-type": contentType(file) });
    res.end(content);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}

async function handleClientMessage(hub: AgentEventHub, options: BridgeOptions, client: WebSocketClient, raw: string): Promise<void> {
  try {
    const message = JSON.parse(raw) as ClientCommand;
    if (message.type === "message") {
      const text = message.text?.trim();
      if (!text) throw new Error("message text is required");
      await (options.onClientMessage ? options.onClientMessage(message, client) : hub.runMessage(text));
      return;
    }
    if (message.type === "tree") {
      const leafId = message.leafId ?? message.text?.replace(/^\/tree\s+/, "").trim();
      if (!options.sessionApi || !message.sessionId || !leafId) throw new Error("tree requires sessionApi, sessionId, and leafId");
      await options.sessionApi.tree(message.sessionId, leafId);
      client.sendJson({ type: "tree_updated", sessionId: message.sessionId, leafId });
      return;
    }
    if (message.type === "fork") {
      if (!options.sessionApi || !message.sessionId || !message.entryId) throw new Error("fork requires sessionApi, sessionId, and entryId");
      const sessionId = await options.sessionApi.fork(message.sessionId, message.entryId);
      client.sendJson({ type: "session_forked", sessionId });
      return;
    }
    if (message.type === "clone") {
      if (!options.sessionApi || !message.sessionId) throw new Error("clone requires sessionApi and sessionId");
      const sessionId = await options.sessionApi.clone(message.sessionId);
      client.sendJson({ type: "session_cloned", sessionId });
      return;
    }
    throw new Error(`Unsupported client message type: ${(message as { type?: string }).type}`);
  } catch (error) {
    client.sendJson({ type: "bridge_error", error: error instanceof Error ? error.message : String(error) });
  }
}

function contentType(file: string): string { return file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html"; }
