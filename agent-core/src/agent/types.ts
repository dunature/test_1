import type { ChatMessage, ModelDescriptor, ProviderAdapter, StreamEvent, ToolDefinition } from "../providers/index.js";
import type { ToolExecutionRecord, ToolRegistry } from "../tools/index.js";

export type AgentEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "agent_end"; sessionId: string; messages: ChatMessage[] }
  | { type: "turn_start"; sessionId: string; turn: number }
  | { type: "turn_end"; sessionId: string; turn: number; message: ChatMessage; toolResults: ToolExecutionRecord[] }
  | { type: "message_delta"; sessionId: string; turn: number; delta: StreamEvent }
  | { type: "tool_execution_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; sessionId: string; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_execution_end"; sessionId: string; toolCallId: string; toolName: string; result?: unknown; error?: string; isError: boolean };

export interface AgentSessionOptions {
  sessionId?: string;
  provider: ProviderAdapter;
  model: ModelDescriptor;
  auth: { apiKey?: string; headers?: Record<string, string> };
  tools?: ToolRegistry;
  systemPrompt?: string;
  maxTurns?: number;
  temperature?: number;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  events: AgentEvent[];
}

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;

export function providerToolsFromRegistry(registry: ToolRegistry | undefined): ToolDefinition[] | undefined {
  const tools = registry?.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
  return tools && tools.length > 0 ? tools : undefined;
}
