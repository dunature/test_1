import { AuthStorage } from "./auth-storage.js";
import type { LlmModelId, LlmProviderId, ModelDescriptor, ModelRequestAuth } from "./types.js";
export interface ProviderConfig {
    name?: string;
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
    models: Array<{
        id: string;
        name?: string;
        contextWindow?: number;
        maxOutputTokens?: number;
        input?: Array<"text" | "image">;
        supportsTools?: boolean;
        headers?: Record<string, string>;
    }>;
}
export interface ModelsConfig {
    providers: Record<string, ProviderConfig>;
}
export type ResolvedModelAuth = {
    ok: true;
    auth: ModelRequestAuth;
} | {
    ok: false;
    error: string;
};
export declare class ModelRegistry {
    readonly authStorage: AuthStorage;
    private readonly modelsJsonPath?;
    private models;
    private providerConfigs;
    private modelHeaders;
    private loadError;
    private constructor();
    static create(authStorage: AuthStorage, modelsJsonPath?: string): ModelRegistry;
    static inMemory(authStorage: AuthStorage, config?: ModelsConfig): ModelRegistry;
    refresh(): void;
    getError(): string | undefined;
    getAll(): ModelDescriptor[];
    getAvailable(): ModelDescriptor[];
    find(provider: LlmProviderId, modelId: LlmModelId): ModelDescriptor | undefined;
    registerProvider(provider: LlmProviderId, config: ProviderConfig): void;
    getAuthForModel(model: ModelDescriptor): Promise<ResolvedModelAuth>;
    private loadFromConfig;
    private upsertProvider;
    private validateConfig;
    private validateProvider;
}
