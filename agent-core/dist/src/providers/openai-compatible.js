export class OpenAICompatibleAdapter {
    fetchImpl;
    id;
    constructor(providerId = "openai", fetchImpl = fetch) {
        this.fetchImpl = fetchImpl;
        this.id = providerId;
    }
    async *stream(request) {
        const init = {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "text/event-stream",
                ...(request.auth.apiKey ? { authorization: `Bearer ${request.auth.apiKey}` } : {}),
                ...request.auth.headers,
            },
            body: JSON.stringify({
                model: request.model.id,
                messages: request.messages.map(toOpenAIMessage),
                tools: request.tools?.map(toOpenAITool),
                stream: true,
                temperature: request.temperature,
                max_tokens: request.maxOutputTokens ?? request.model.maxOutputTokens,
                stream_options: { include_usage: true },
            }),
        };
        if (request.signal)
            init.signal = request.signal;
        const response = await this.fetchImpl(`${request.model.baseUrl}/chat/completions`, init);
        if (!response.ok || !response.body) {
            const text = await safeText(response);
            throw new Error(`LLM request failed (${response.status}): ${text || response.statusText}`);
        }
        yield { type: "message_start", provider: request.model.provider, model: request.model.id };
        let finishReason;
        let usage;
        for await (const event of parseServerSentEvents(response.body)) {
            if (event === "[DONE]")
                break;
            const parsed = JSON.parse(event);
            const choice = parsed.choices?.[0];
            finishReason = choice?.finish_reason ?? finishReason;
            if (parsed.usage) {
                usage = {};
                if (parsed.usage.prompt_tokens !== undefined)
                    usage.inputTokens = parsed.usage.prompt_tokens;
                if (parsed.usage.completion_tokens !== undefined)
                    usage.outputTokens = parsed.usage.completion_tokens;
                if (parsed.usage.total_tokens !== undefined)
                    usage.totalTokens = parsed.usage.total_tokens;
            }
            const delta = choice?.delta;
            if (typeof delta?.content === "string" && delta.content.length > 0) {
                yield { type: "content_delta", delta: delta.content };
            }
            for (const toolCall of delta?.tool_calls ?? []) {
                const event = { type: "tool_call_delta", index: toolCall.index };
                if (toolCall.id !== undefined)
                    event.id = toolCall.id;
                if (toolCall.function?.name !== undefined)
                    event.name = toolCall.function.name;
                if (toolCall.function?.arguments !== undefined)
                    event.argumentsDelta = toolCall.function.arguments;
                yield event;
            }
        }
        const stopEvent = { type: "message_stop" };
        if (finishReason !== undefined)
            stopEvent.finishReason = finishReason;
        if (usage !== undefined)
            stopEvent.usage = usage;
        yield stopEvent;
    }
}
function toOpenAIMessage(message) {
    const converted = { role: message.role, content: message.content };
    if (message.name)
        converted.name = message.name;
    if (message.toolCallId)
        converted.tool_call_id = message.toolCallId;
    if (message.toolCalls) {
        converted.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }));
    }
    return converted;
}
function toOpenAITool(tool) {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        },
    };
}
async function* parseServerSentEvents(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
            const raw = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = raw
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
            if (data)
                yield data;
        }
    }
    const tail = buffer.trim();
    if (tail.startsWith("data:"))
        yield tail.slice(5).trimStart();
}
async function safeText(response) {
    try {
        return await response.text();
    }
    catch {
        return "";
    }
}
