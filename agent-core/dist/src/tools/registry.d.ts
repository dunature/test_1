import type { ModelAgentTool, RegisteredTool, ToolCall, AgentTool, ToolExecutionRecord, ToolRegistryOptions } from "./types.js";
export declare class ToolRegistry {
    private tools;
    private readonly maxTextResultChars;
    private readonly permission;
    private readonly permissionRole;
    constructor(options?: ToolRegistryOptions);
    register<TParams, TDetails, TOperations>(definition: AgentTool<TParams, TDetails, TOperations>): RegisteredTool<TParams, TDetails, TOperations>;
    unregister(name: string): boolean;
    get<TParams = unknown, TDetails = unknown, TOperations = unknown>(name: string): RegisteredTool<TParams, TDetails, TOperations> | undefined;
    list(): RegisteredTool[];
    toModelTools(): ModelAgentTool[];
    execute<TDetails = unknown>(call: ToolCall, options?: {
        signal?: AbortSignal;
    }): Promise<ToolExecutionRecord<TDetails>>;
    private errorRecord;
}
export declare function defineTool<TParams, TDetails = unknown, TOperations = unknown>(definition: AgentTool<TParams, TDetails, TOperations>): AgentTool<TParams, TDetails, TOperations>;
