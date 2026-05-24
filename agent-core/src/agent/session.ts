import type { ChatMessage, StreamEvent } from "../providers/index.js";
import type { ToolCall, ToolExecutionRecord } from "../tools/index.js";
import { providerToolsFromRegistry, type AgentEvent, type AgentEventListener, type AgentRunOptions, type AgentRunResult, type AgentSessionOptions } from "./types.js";

interface PendingToolCall {
  id?: string;
  name?: string;
  argumentsText: string;
}

export class AgentSession {
  readonly sessionId: string;
  private readonly listeners = new Set<AgentEventListener>();
  private readonly provider;
  private readonly model;
  private readonly auth;
  private readonly tools;
  private readonly systemPrompt;
  private readonly maxTurns;
  private readonly temperature;
  private messages: ChatMessage[] = [];
  private events: AgentEvent[] = [];

  constructor(options: AgentSessionOptions) {
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.provider = options.provider;
    this.model = options.model;
    this.auth = options.auth;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.maxTurns = options.maxTurns ?? 8;
    this.temperature = options.temperature;
    if (this.systemPrompt) this.messages.push({ role: "system", content: this.systemPrompt });
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  async run(userContent: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    this.events = [];
    this.messages.push({ role: "user", content: userContent });
    await this.emit({ type: "agent_start", sessionId: this.sessionId });

    try {
      for (let turn = 1; turn <= this.maxTurns; turn++) {
        const { assistantMessage, toolCalls, toolResults } = await this.runTurn(turn, options.signal);
        this.messages.push(assistantMessage);

        if (toolCalls.length === 0) {
          await this.emit({ type: "turn_end", sessionId: this.sessionId, turn, message: assistantMessage, toolResults: [] });
          break;
        }

        for (const result of toolResults) {
          this.messages.push({
            role: "tool",
            toolCallId: result.call.id,
            content: result.isError ? result.error ?? "Tool execution failed" : toolResultToText(result),
          });
        }

        await this.emit({ type: "turn_end", sessionId: this.sessionId, turn, message: assistantMessage, toolResults });

        if (toolResults.some((result) => result.result?.terminate)) break;
        if (turn === this.maxTurns) throw new Error(`Agent exceeded maxTurns=${this.maxTurns}`);
      }
    } finally {
      await this.emit({ type: "agent_end", sessionId: this.sessionId, messages: this.getMessages() });
    }

    return { messages: this.getMessages(), events: [...this.events] };
  }

  private async runTurn(turn: number, signal: AbortSignal | undefined): Promise<{ assistantMessage: ChatMessage; toolCalls: ToolCall[]; toolResults: ToolExecutionRecord[] }> {
    await this.emit({ type: "turn_start", sessionId: this.sessionId, turn });

    let content = "";
    const pendingToolCalls = new Map<number, PendingToolCall>();
    let finishReason: string | undefined;

    const request: any = {
      model: this.model,
      auth: this.auth,
      messages: this.messages,
    };
    const tools = providerToolsFromRegistry(this.tools);
    if (tools) request.tools = tools;
    if (this.temperature !== undefined) request.temperature = this.temperature;
    if (signal) request.signal = signal;

    for await (const delta of this.provider.stream(request)) {
      await this.emit({ type: "message_delta", sessionId: this.sessionId, turn, delta });
      if (delta.type === "content_delta") content += delta.delta;
      if (delta.type === "tool_call_delta") {
        const current = pendingToolCalls.get(delta.index) ?? { argumentsText: "" };
        if (delta.id !== undefined) current.id = delta.id;
        if (delta.name !== undefined) current.name = delta.name;
        if (delta.argumentsDelta !== undefined) current.argumentsText += delta.argumentsDelta;
        pendingToolCalls.set(delta.index, current);
      }
      if (delta.type === "message_stop") finishReason = delta.finishReason;
    }

    const toolCalls = [...pendingToolCalls.entries()].sort(([a], [b]) => a - b).map(([, call], index) => materializeToolCall(call, index));
    const assistantMessage: ChatMessage = { role: "assistant", content };
    if (toolCalls.length > 0) assistantMessage.toolCalls = toolCalls;
    if (finishReason) assistantMessage.finishReason = finishReason;

    const toolResults: ToolExecutionRecord[] = [];
    for (const call of toolCalls) {
      await this.emit({ type: "tool_execution_start", sessionId: this.sessionId, toolCallId: call.id, toolName: call.name, args: call.arguments });
      const record = this.tools
        ? await this.tools.execute(call, signal ? { signal } : {})
        : ({ call, isError: true, error: "No tool registry configured", startedAt: new Date().toISOString(), endedAt: new Date().toISOString() } satisfies ToolExecutionRecord);
      toolResults.push(record);
      const event: AgentEvent = {
        type: "tool_execution_end",
        sessionId: this.sessionId,
        toolCallId: call.id,
        toolName: call.name,
        isError: record.isError,
      };
      if (record.result !== undefined) event.result = record.result;
      if (record.error !== undefined) event.error = record.error;
      await this.emit(event);
    }

    return { assistantMessage, toolCalls, toolResults };
  }

  private async emit(event: AgentEvent): Promise<void> {
    this.events.push(event);
    for (const listener of this.listeners) await listener(event);
  }
}

function materializeToolCall(call: PendingToolCall, index: number): ToolCall {
  if (!call.name) throw new Error(`Tool call ${index} is missing function name`);
  let args: unknown;
  try {
    args = call.argumentsText ? JSON.parse(call.argumentsText) : {};
  } catch (error) {
    throw new Error(`Tool call ${call.name} has invalid JSON arguments: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { id: call.id ?? `tool_call_${index}`, name: call.name, arguments: args };
}

function toolResultToText(record: ToolExecutionRecord): string {
  return (record.result?.content ?? [])
    .map((item) => item.type === "text" ? item.text : `[image:${item.mimeType}]`)
    .join("\n");
}
