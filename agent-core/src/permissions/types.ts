import type { ToolCall } from "../tools/index.js";

export type PermissionMode = "allow" | "ask" | "deny";
export type PermissionRole = "readonly" | "backtest";

export interface PermissionDecision {
  mode: PermissionMode;
  reason?: string;
}

export interface PermissionContext {
  role: PermissionRole;
  toolCall: ToolCall;
}

export interface PermissionRule {
  tools: string[];
  mode: PermissionMode;
  reason?: string;
}

export interface PermissionConfig {
  role: PermissionRole;
  rules: PermissionRule[];
  defaultMode: PermissionMode;
}

export type PermissionMiddleware = (context: PermissionContext) => PermissionDecision | Promise<PermissionDecision>;
