import { type AgentTool } from "../index.js";
export type ResourceSource = "file" | "url" | "virtual";
export interface ResourceMetadata {
    id: string;
    source: ResourceSource;
    uri: string;
    name: string;
    size: number;
    sha256: string;
    summary: string;
}
export interface LoadResourceParams {
    source: ResourceSource;
    uri: string;
    limit?: number;
}
export interface LoadResourceDetails extends ResourceMetadata {
    contentPreview?: string;
}
export interface ResourceOperations {
    load(params: LoadResourceParams): Promise<{
        metadata: ResourceMetadata;
        contentPreview?: string;
    }>;
}
export declare function createDefaultResourceOperations(cwd?: string, fetchImpl?: typeof fetch): ResourceOperations;
export declare function createLoadResourceTool(operations: ResourceOperations): AgentTool<LoadResourceParams, LoadResourceDetails, ResourceOperations>;
