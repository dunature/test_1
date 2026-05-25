const defaultMaxTextResultChars = 12_000;
export class ToolRegistry {
    tools = new Map();
    maxTextResultChars;
    permission;
    permissionRole;
    constructor(options = {}) {
        this.maxTextResultChars = options.maxTextResultChars ?? defaultMaxTextResultChars;
        this.permission = options.permission;
        this.permissionRole = options.permissionRole ?? "backtest";
    }
    register(definition) {
        const normalized = normalizeTool(definition);
        if (this.tools.has(normalized.name))
            throw new Error(`Tool already registered: ${normalized.name}`);
        this.tools.set(normalized.name, normalized);
        return normalized;
    }
    unregister(name) {
        return this.tools.delete(name);
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return [...this.tools.values()];
    }
    toModelTools() {
        return this.list().map((tool) => tool.toModelTool());
    }
    async execute(call, options = {}) {
        const startedAt = new Date().toISOString();
        const tool = this.tools.get(call.name);
        if (!tool) {
            return this.errorRecord(call, startedAt, `Unknown tool: ${call.name}`);
        }
        try {
            if (this.permission) {
                const permission = await this.permission({ role: this.permissionRole, toolCall: call });
                if (permission.mode !== "allow") {
                    return this.errorRecord(call, startedAt, permission.reason ?? `permission denied: ${call.name}`);
                }
            }
            const prepared = tool.prepareArguments ? tool.prepareArguments(call.arguments) : call.arguments;
            validateAgainstSchema(tool.parameters, prepared, tool.name);
            const ctx = { toolCallId: call.id, params: prepared };
            if (options.signal)
                ctx.signal = options.signal;
            if (tool.operations !== undefined)
                ctx.operations = tool.operations;
            const result = await tool.execute(ctx);
            const normalizedResult = truncateTextContent(result, this.maxTextResultChars);
            return {
                call,
                result: normalizedResult,
                isError: false,
                startedAt,
                endedAt: new Date().toISOString(),
            };
        }
        catch (error) {
            return this.errorRecord(call, startedAt, error instanceof Error ? error.message : String(error));
        }
    }
    errorRecord(call, startedAt, error) {
        return {
            call,
            error,
            isError: true,
            startedAt,
            endedAt: new Date().toISOString(),
        };
    }
}
export function defineTool(definition) {
    return definition;
}
function normalizeTool(definition) {
    validateAgentTool(definition);
    return {
        ...definition,
        toModelTool() {
            return {
                type: "function",
                function: {
                    name: definition.name,
                    description: definition.description,
                    parameters: definition.parameters,
                },
            };
        },
    };
}
function validateAgentTool(definition) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(definition.name)) {
        throw new Error(`Invalid tool name: ${definition.name}`);
    }
    if (!definition.description.trim())
        throw new Error(`Tool ${definition.name} requires description`);
    if (!definition.parameters || typeof definition.parameters !== "object") {
        throw new Error(`Tool ${definition.name} requires JSON schema parameters`);
    }
}
function validateAgainstSchema(schema, value, toolName) {
    if (schema.type === "object") {
        if (!isRecord(value))
            throw new Error(`Tool ${toolName} arguments must be an object`);
        for (const required of schema.required ?? []) {
            if (!(required in value))
                throw new Error(`Tool ${toolName} missing required argument: ${required}`);
        }
        for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
            if (key in value)
                validateAgainstSchema(propertySchema, value[key], `${toolName}.${key}`);
        }
        if (schema.additionalProperties === false) {
            const allowed = new Set(Object.keys(schema.properties ?? {}));
            for (const key of Object.keys(value)) {
                if (!allowed.has(key))
                    throw new Error(`Tool ${toolName} unknown argument: ${key}`);
            }
        }
    }
    if (schema.type === "string" && typeof value !== "string")
        throw new Error(`${toolName} must be a string`);
    if (schema.type === "number" && typeof value !== "number")
        throw new Error(`${toolName} must be a number`);
    if (schema.type === "integer" && (!Number.isInteger(value)))
        throw new Error(`${toolName} must be an integer`);
    if (schema.type === "boolean" && typeof value !== "boolean")
        throw new Error(`${toolName} must be a boolean`);
    if (schema.enum && !schema.enum.includes(value))
        throw new Error(`${toolName} must be one of ${schema.enum.join(", ")}`);
}
function truncateTextContent(result, maxChars) {
    return {
        ...result,
        content: result.content.map((item) => {
            if (item.type !== "text" || item.text.length <= maxChars)
                return item;
            return {
                type: "text",
                text: `${item.text.slice(0, maxChars)}\n\n[tool output truncated at ${maxChars} chars; narrow the request or use offset/limit to continue]`,
            };
        }),
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
