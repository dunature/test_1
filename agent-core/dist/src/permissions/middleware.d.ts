import type { PermissionConfig, PermissionDecision, PermissionMiddleware, PermissionRole } from "./types.js";
export declare const permissionConfigs: Record<PermissionRole, PermissionConfig>;
export declare function createPermissionMiddleware(role: PermissionRole, override?: Partial<PermissionConfig>): PermissionMiddleware;
export declare function decision(mode: "allow" | "ask" | "deny", reason?: string): PermissionDecision;
