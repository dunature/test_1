export type ToolExecutionMode = "parallel" | "sequential";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  mimeType: string;
  data: string;
}

export type ToolContent = TextContent | ImageContent;

export interface ToolResult<TDetails = unknown> {
  content: ToolContent[];
  details: TDetails;
  terminate?: boolean;
}

export type ToolUpdateCallback<TDetails = unknown> = (partialResult: ToolResult<TDetails>) => void;

export interface ToolRenderContext<TDetails = unknown> {
  toolName: string;
  callId: string;
  details?: TDetails;
}

export interface AgentTool<TParams = unknown, TDetails = unknown, TOperations = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  details?: Record<string, unknown>;
  operations?: TOperations;
  executionMode?: ToolExecutionMode;
  prepareArguments?: (args: unknown) => TParams;
  execute: (ctx: ToolExecutionContext<TParams, TOperations>) => Promise<ToolResult<TDetails>> | ToolResult<TDetails>;
  renderCall?: (params: TParams, context: ToolRenderContext<TDetails>) => string;
  renderResult?: (result: ToolResult<TDetails>, context: ToolRenderContext<TDetails>) => string;
}

export interface RegisteredTool<TParams = unknown, TDetails = unknown, TOperations = unknown>
  extends AgentTool<TParams, TDetails, TOperations> {
  toModelTool(): ModelAgentTool;
}

export interface ToolExecutionContext<TParams = unknown, TOperations = unknown> {
  toolCallId: string;
  params: TParams;
  signal?: AbortSignal;
  onUpdate?: ToolUpdateCallback;
  operations?: TOperations;
}

export interface ToolCall<TArgs = unknown> {
  id: string;
  name: string;
  arguments: TArgs;
}

export interface ToolExecutionRecord<TDetails = unknown> {
  call: ToolCall;
  result?: ToolResult<TDetails>;
  error?: string;
  isError: boolean;
  startedAt: string;
  endedAt: string;
}

export interface ModelAgentTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: JsonSchema;
  description?: string;
  [key: string]: unknown;
};

export interface ToolRegistryOptions {
  maxTextResultChars?: number;
  permission?: import("../permissions/index.js").PermissionMiddleware;
  permissionRole?: import("../permissions/index.js").PermissionRole;
}
