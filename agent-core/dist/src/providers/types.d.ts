export type LlmProviderId = string;
export type LlmModelId = string;
export type ChatRole = "system" | "user" | "assistant" | "tool";
export interface ChatMessage {
    role: ChatRole;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: unknown;
    }>;
    finishReason?: string;
}
export interface ToolDefinition {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}
export interface ModelDescriptor {
    provider: LlmProviderId;
    id: LlmModelId;
    name: string;
    api: "openai-compatible";
    baseUrl: string;
    contextWindow: number;
    maxOutputTokens: number;
    input: Array<"text" | "image">;
    supportsTools: boolean;
    headers?: Record<string, string>;
}
export interface ModelRequestAuth {
    apiKey?: string;
    headers?: Record<string, string>;
}
export type StreamEvent = {
    type: "message_start";
    provider: string;
    model: string;
} | {
    type: "content_delta";
    delta: string;
} | {
    type: "tool_call_delta";
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
} | {
    type: "message_stop";
    finishReason?: string;
    usage?: TokenUsage;
} | {
    type: "error";
    error: string;
};
export interface TokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}
export interface StreamRequest {
    model: ModelDescriptor;
    messages: ChatMessage[];
    auth: ModelRequestAuth;
    tools?: ToolDefinition[];
    temperature?: number;
    maxOutputTokens?: number;
    signal?: AbortSignal;
}
export interface ProviderAdapter {
    readonly id: LlmProviderId;
    stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}
