import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeResolve } from "../safe-path.js";
import { JsonlSessionTree } from "../session-tree/index.js";
export class AgentEventHub {
    clients = new Set();
    sessions = new Set();
    clientSessions = new Map();
    attach(session) { this.sessions.add(session); session.subscribe((event) => this.broadcast(event)); }
    add(client) {
        this.clients.add(client);
        client.addCloseListener(() => {
            this.clients.delete(client);
            this.clientSessions.delete(client);
        });
    }
    clientCount() { return this.clients.size; }
    sessionCount() { return this.sessions.size + this.clientSessions.size; }
    getOrCreateClientSession(client, factory) {
        const existing = this.clientSessions.get(client);
        if (existing)
            return existing;
        const session = factory(client);
        session.subscribe((event) => client.sendJson(event));
        this.clientSessions.set(client, session);
        return session;
    }
    broadcast(event) { for (const client of this.clients)
        client.sendJson(event); }
    async runMessage(text) {
        const session = this.sessions.values().next().value;
        if (!session)
            throw new Error("No agent session attached");
        await session.run(text);
    }
}
export class WebSocketClient {
    socket;
    sessionId = crypto.randomUUID();
    onClose;
    onMessage;
    closeListeners = new Set();
    buffer = Buffer.alloc(0);
    constructor(socket) {
        this.socket = socket;
        socket.on("close", () => {
            this.onClose?.();
            for (const listener of this.closeListeners)
                listener();
        });
        socket.on("data", (chunk) => this.readFrames(chunk));
    }
    addCloseListener(listener) { this.closeListeners.add(listener); }
    sendJson(value) { this.sendText(JSON.stringify(value)); }
    sendText(text) {
        const payload = Buffer.from(text);
        const header = createTextFrameHeader(payload.length);
        this.socket.write(Buffer.concat([header, payload]));
    }
    readFrames(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 2) {
            const first = this.buffer[0];
            const second = this.buffer[1];
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (this.buffer.length < 4)
                    return;
                length = this.buffer.readUInt16BE(2);
                offset = 4;
            }
            else if (length === 127) {
                if (this.buffer.length < 10)
                    return;
                const bigLength = this.buffer.readBigUInt64BE(2);
                if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
                    this.socket.destroy();
                    return;
                }
                length = Number(bigLength);
                offset = 10;
            }
            const maskOffset = offset;
            if (masked)
                offset += 4;
            if (this.buffer.length < offset + length)
                return;
            const mask = masked ? this.buffer.subarray(maskOffset, maskOffset + 4) : undefined;
            let payload = this.buffer.subarray(offset, offset + length);
            this.buffer = this.buffer.subarray(offset + length);
            if (opcode === 0x8) {
                this.socket.end();
                return;
            }
            if (opcode !== 0x1)
                continue;
            if (mask)
                payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
            void this.onMessage?.(payload.toString("utf8"));
        }
    }
}
function createTextFrameHeader(payloadLength) {
    if (payloadLength < 126)
        return Buffer.from([0x81, payloadLength]);
    if (payloadLength < 65_536)
        return Buffer.from([0x81, 126, payloadLength >> 8, payloadLength & 0xff]);
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
    return header;
}
export function createBridgeServer(hub, options = {}) {
    const staticDir = options.staticDir ?? join(process.cwd(), "public");
    const startedAt = options.startedAt ?? Date.now();
    const server = createServer(async (req, res) => serveHttp(req, res, staticDir, startedAt, hub));
    server.on("upgrade", (req, socket) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/" && url.pathname !== "/ws")
            return socket.destroy();
        if (req.headers.upgrade?.toLowerCase() !== "websocket")
            return socket.destroy();
        const key = req.headers["sec-websocket-key"];
        if (typeof key !== "string")
            return socket.destroy();
        const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
        const client = new WebSocketClient(socket);
        client.onMessage = (raw) => handleClientMessage(hub, options, client, raw);
        hub.add(client);
    });
    return server;
}
export function createSessionApi(sessionDir) {
    return {
        async create() { const id = crypto.randomUUID(); await JsonlSessionTree.open(join(sessionDir, `${id}.jsonl`)); return id; },
        async tree(sessionId, leafId) { const tree = await JsonlSessionTree.open(join(sessionDir, `${sessionId}.jsonl`)); await tree.tree(leafId); },
        async fork(sessionId, entryId) { const tree = await JsonlSessionTree.open(join(sessionDir, `${sessionId}.jsonl`)); await tree.fork(entryId); return sessionId; },
        async clone(sessionId) { const tree = await JsonlSessionTree.open(join(sessionDir, `${sessionId}.jsonl`)); const id = crypto.randomUUID(); await tree.clone(join(sessionDir, `${id}.jsonl`)); return id; },
    };
}
async function serveHttp(req, res, staticDir, startedAt, hub) {
    try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/healthz") {
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify({
                status: "ok",
                uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
                active_ws_clients: hub.clientCount(),
                attached_sessions: hub.sessionCount(),
            }));
            return;
        }
        const file = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
        const content = await readFile(safeResolve(staticDir, file, "static file"));
        res.writeHead(200, { "content-type": contentType(file) });
        res.end(content);
    }
    catch {
        res.writeHead(404);
        res.end("not found");
    }
}
async function handleClientMessage(hub, options, client, raw) {
    try {
        const message = JSON.parse(raw);
        if (message.type === "message") {
            const text = message.text?.trim();
            if (!text)
                throw new Error("message text is required");
            if (options.onClientMessage) {
                await options.onClientMessage(message, client);
            }
            else if (options.sessionFactory) {
                await hub.getOrCreateClientSession(client, options.sessionFactory).run(text);
            }
            else {
                await hub.runMessage(text);
            }
            return;
        }
        if (message.type === "tree") {
            const leafId = message.leafId ?? message.text?.replace(/^\/tree\s+/, "").trim();
            if (!options.sessionApi || !message.sessionId || !leafId)
                throw new Error("tree requires sessionApi, sessionId, and leafId");
            await options.sessionApi.tree(message.sessionId, leafId);
            client.sendJson({ type: "tree_updated", sessionId: message.sessionId, leafId });
            return;
        }
        if (message.type === "fork") {
            if (!options.sessionApi || !message.sessionId || !message.entryId)
                throw new Error("fork requires sessionApi, sessionId, and entryId");
            const sessionId = await options.sessionApi.fork(message.sessionId, message.entryId);
            client.sendJson({ type: "session_forked", sessionId });
            return;
        }
        if (message.type === "clone") {
            if (!options.sessionApi || !message.sessionId)
                throw new Error("clone requires sessionApi and sessionId");
            const sessionId = await options.sessionApi.clone(message.sessionId);
            client.sendJson({ type: "session_cloned", sessionId });
            return;
        }
        throw new Error(`Unsupported client message type: ${message.type}`);
    }
    catch (error) {
        client.sendJson({ type: "bridge_error", error: error instanceof Error ? error.message : String(error) });
    }
}
function contentType(file) { return file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html"; }
