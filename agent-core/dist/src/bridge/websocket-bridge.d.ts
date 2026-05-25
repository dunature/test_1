import { type Server } from "node:http";
import type { Socket } from "node:net";
import type { AgentEvent, AgentSession } from "../agent/index.js";
export interface SessionApi {
    create(): Promise<string>;
    tree(sessionId: string, leafId: string): Promise<void>;
    fork(sessionId: string, entryId: string): Promise<string>;
    clone(sessionId: string): Promise<string>;
}
export interface ClientCommand {
    type: "message" | "tree" | "fork" | "clone";
    text?: string;
    sessionId?: string;
    leafId?: string;
    entryId?: string;
}
export interface BridgeOptions {
    staticDir?: string;
    sessionDir?: string;
    sessionApi?: SessionApi;
    startedAt?: number;
    sessionFactory?: (client: WebSocketClient) => AgentSession;
    onClientMessage?: (message: ClientCommand, client: WebSocketClient) => void | Promise<void>;
}
export declare class AgentEventHub {
    private clients;
    private sessions;
    private clientSessions;
    attach(session: AgentSession): void;
    add(client: WebSocketClient): void;
    clientCount(): number;
    sessionCount(): number;
    getOrCreateClientSession(client: WebSocketClient, factory: (client: WebSocketClient) => AgentSession): AgentSession;
    broadcast(event: AgentEvent): void;
    runMessage(text: string): Promise<void>;
}
export declare class WebSocketClient {
    private readonly socket;
    readonly sessionId: `${string}-${string}-${string}-${string}-${string}`;
    onClose?: () => void;
    onMessage?: (text: string) => void | Promise<void>;
    private closeListeners;
    private buffer;
    constructor(socket: Socket);
    addCloseListener(listener: () => void): void;
    sendJson(value: unknown): void;
    sendText(text: string): void;
    private readFrames;
}
export declare function createBridgeServer(hub: AgentEventHub, options?: BridgeOptions): Server;
export declare function createSessionApi(sessionDir: string): SessionApi;
