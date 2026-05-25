import type { ChatMessage } from "../providers/index.js";
import { type AgentEventListener, type AgentRunOptions, type AgentRunResult, type AgentSessionOptions } from "./types.js";
export declare class AgentSession {
    readonly sessionId: string;
    private readonly listeners;
    private readonly provider;
    private readonly model;
    private readonly auth;
    private readonly tools;
    private readonly systemPrompt;
    private readonly maxTurns;
    private readonly temperature;
    private messages;
    private events;
    constructor(options: AgentSessionOptions);
    subscribe(listener: AgentEventListener): () => void;
    getMessages(): ChatMessage[];
    run(userContent: string, options?: AgentRunOptions): Promise<AgentRunResult>;
    private runTurn;
    private emit;
}
