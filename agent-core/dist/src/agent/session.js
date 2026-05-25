import { providerToolsFromRegistry } from "./types.js";
export class AgentSession {
    sessionId;
    listeners = new Set();
    provider;
    model;
    auth;
    tools;
    systemPrompt;
    maxTurns;
    temperature;
    messages = [];
    events = [];
    constructor(options) {
        this.sessionId = options.sessionId ?? crypto.randomUUID();
        this.provider = options.provider;
        this.model = options.model;
        this.auth = options.auth;
        this.tools = options.tools;
        this.systemPrompt = options.systemPrompt;
        this.maxTurns = options.maxTurns ?? 8;
        this.temperature = options.temperature;
        if (this.systemPrompt)
            this.messages.push({ role: "system", content: this.systemPrompt });
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    getMessages() {
        return [...this.messages];
    }
    async run(userContent, options = {}) {
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
                if (toolResults.some((result) => result.result?.terminate))
                    break;
                if (turn === this.maxTurns)
                    throw new Error(`Agent exceeded maxTurns=${this.maxTurns}`);
            }
        }
        finally {
            await this.emit({ type: "agent_end", sessionId: this.sessionId, messages: this.getMessages() });
        }
        return { messages: this.getMessages(), events: [...this.events] };
    }
    async runTurn(turn, signal) {
        await this.emit({ type: "turn_start", sessionId: this.sessionId, turn });
        let content = "";
        const pendingToolCalls = new Map();
        let finishReason;
        const request = {
            model: this.model,
            auth: this.auth,
            messages: this.messages,
        };
        const tools = providerToolsFromRegistry(this.tools);
        if (tools)
            request.tools = tools;
        if (this.temperature !== undefined)
            request.temperature = this.temperature;
        if (signal)
            request.signal = signal;
        for await (const delta of this.provider.stream(request)) {
            await this.emit({ type: "message_delta", sessionId: this.sessionId, turn, delta });
            if (delta.type === "content_delta")
                content += delta.delta;
            if (delta.type === "tool_call_delta") {
                const current = pendingToolCalls.get(delta.index) ?? { argumentsText: "" };
                if (delta.id !== undefined)
                    current.id = delta.id;
                if (delta.name !== undefined)
                    current.name = delta.name;
                if (delta.argumentsDelta !== undefined)
                    current.argumentsText += delta.argumentsDelta;
                pendingToolCalls.set(delta.index, current);
            }
            if (delta.type === "message_stop")
                finishReason = delta.finishReason;
        }
        const toolCalls = [...pendingToolCalls.entries()].sort(([a], [b]) => a - b).map(([, call], index) => materializeToolCall(call, index));
        const assistantMessage = { role: "assistant", content };
        if (toolCalls.length > 0)
            assistantMessage.toolCalls = toolCalls;
        if (finishReason)
            assistantMessage.finishReason = finishReason;
        const toolResults = [];
        for (const call of toolCalls) {
            await this.emit({ type: "tool_execution_start", sessionId: this.sessionId, toolCallId: call.id, toolName: call.name, args: call.arguments });
            const record = this.tools
                ? await this.tools.execute(call, signal ? { signal } : {})
                : { call, isError: true, error: "No tool registry configured", startedAt: new Date().toISOString(), endedAt: new Date().toISOString() };
            toolResults.push(record);
            const event = {
                type: "tool_execution_end",
                sessionId: this.sessionId,
                toolCallId: call.id,
                toolName: call.name,
                isError: record.isError,
            };
            if (record.result !== undefined)
                event.result = record.result;
            if (record.error !== undefined)
                event.error = record.error;
            await this.emit(event);
        }
        return { assistantMessage, toolCalls, toolResults };
    }
    async emit(event) {
        this.events.push(event);
        for (const listener of this.listeners)
            await listener(event);
    }
}
function materializeToolCall(call, index) {
    if (!call.name)
        throw new Error(`Tool call ${index} is missing function name`);
    let args;
    try {
        args = call.argumentsText ? JSON.parse(call.argumentsText) : {};
    }
    catch (error) {
        throw new Error(`Tool call ${call.name} has invalid JSON arguments: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { id: call.id ?? `tool_call_${index}`, name: call.name, arguments: args };
}
function toolResultToText(record) {
    return (record.result?.content ?? [])
        .map((item) => item.type === "text" ? item.text : `[image:${item.mimeType}]`)
        .join("\n");
}
