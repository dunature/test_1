import type {
  JsonSchema,
  ModelAgentTool,
  RegisteredTool,
  ToolCall,
  AgentTool,
  ToolExecutionRecord,
  ToolRegistryOptions,
  ToolResult,
} from "./types.js";

const defaultMaxTextResultChars = 12_000;

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private readonly maxTextResultChars: number;
  private readonly permission: import("../permissions/index.js").PermissionMiddleware | undefined;
  private readonly permissionRole: import("../permissions/index.js").PermissionRole;

  constructor(options: ToolRegistryOptions = {}) {
    this.maxTextResultChars = options.maxTextResultChars ?? defaultMaxTextResultChars;
    this.permission = options.permission;
    this.permissionRole = options.permissionRole ?? "backtest";
  }

  register<TParams, TDetails, TOperations>(definition: AgentTool<TParams, TDetails, TOperations>): RegisteredTool<TParams, TDetails, TOperations> {
    const normalized = normalizeTool(definition);
    if (this.tools.has(normalized.name)) throw new Error(`Tool already registered: ${normalized.name}`);
    this.tools.set(normalized.name, normalized as RegisteredTool);
    return normalized;
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get<TParams = unknown, TDetails = unknown, TOperations = unknown>(name: string): RegisteredTool<TParams, TDetails, TOperations> | undefined {
    return this.tools.get(name) as RegisteredTool<TParams, TDetails, TOperations> | undefined;
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  toModelTools(): ModelAgentTool[] {
    return this.list().map((tool) => tool.toModelTool());
  }

  async execute<TDetails = unknown>(call: ToolCall, options: { signal?: AbortSignal } = {}): Promise<ToolExecutionRecord<TDetails>> {
    const startedAt = new Date().toISOString();
    const tool = this.tools.get(call.name);
    if (!tool) {
      return this.errorRecord(call, startedAt, `Unknown tool: ${call.name}`) as ToolExecutionRecord<TDetails>;
    }

    try {
      if (this.permission) {
        const permission = await this.permission({ role: this.permissionRole, toolCall: call });
        if (permission.mode !== "allow") {
          return this.errorRecord(call, startedAt, permission.reason ?? `permission denied: ${call.name}`) as ToolExecutionRecord<TDetails>;
        }
      }
      const prepared = tool.prepareArguments ? tool.prepareArguments(call.arguments) : call.arguments;
      validateAgainstSchema(tool.parameters, prepared, tool.name);
      const ctx: any = { toolCallId: call.id, params: prepared };
      if (options.signal) ctx.signal = options.signal;
      if (tool.operations !== undefined) ctx.operations = tool.operations;
      const result = await tool.execute(ctx);
      const normalizedResult = truncateTextContent(result, this.maxTextResultChars) as ToolResult<TDetails>;
      return {
        call,
        result: normalizedResult,
        isError: false,
        startedAt,
        endedAt: new Date().toISOString(),
      };
    } catch (error) {
      return this.errorRecord(call, startedAt, error instanceof Error ? error.message : String(error)) as ToolExecutionRecord<TDetails>;
    }
  }

  private errorRecord(call: ToolCall, startedAt: string, error: string): ToolExecutionRecord {
    return {
      call,
      error,
      isError: true,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }
}

export function defineTool<TParams, TDetails = unknown, TOperations = unknown>(
  definition: AgentTool<TParams, TDetails, TOperations>,
): AgentTool<TParams, TDetails, TOperations> {
  return definition;
}

function normalizeTool<TParams, TDetails, TOperations>(
  definition: AgentTool<TParams, TDetails, TOperations>,
): RegisteredTool<TParams, TDetails, TOperations> {
  validateAgentTool(definition);
  return {
    ...definition,
    toModelTool(): ModelAgentTool {
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

function validateAgentTool(definition: { name: string; description: string; parameters: unknown }): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(definition.name)) {
    throw new Error(`Invalid tool name: ${definition.name}`);
  }
  if (!definition.description.trim()) throw new Error(`Tool ${definition.name} requires description`);
  if (!definition.parameters || typeof definition.parameters !== "object") {
    throw new Error(`Tool ${definition.name} requires JSON schema parameters`);
  }
}

function validateAgainstSchema(schema: JsonSchema, value: unknown, toolName: string): void {
  if (schema.type === "object") {
    if (!isRecord(value)) throw new Error(`Tool ${toolName} arguments must be an object`);
    for (const required of schema.required ?? []) {
      if (!(required in value)) throw new Error(`Tool ${toolName} missing required argument: ${required}`);
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateAgainstSchema(propertySchema, value[key], `${toolName}.${key}`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`Tool ${toolName} unknown argument: ${key}`);
      }
    }
  }

  if (schema.type === "string" && typeof value !== "string") throw new Error(`${toolName} must be a string`);
  if (schema.type === "number" && typeof value !== "number") throw new Error(`${toolName} must be a number`);
  if (schema.type === "integer" && (!Number.isInteger(value))) throw new Error(`${toolName} must be an integer`);
  if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${toolName} must be a boolean`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${toolName} must be one of ${schema.enum.join(", ")}`);
}

function truncateTextContent<TDetails>(result: ToolResult<TDetails>, maxChars: number): ToolResult<TDetails> {
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== "text" || item.text.length <= maxChars) return item;
      return {
        type: "text",
        text: `${item.text.slice(0, maxChars)}\n\n[tool output truncated at ${maxChars} chars; narrow the request or use offset/limit to continue]`,
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
