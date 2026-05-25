export type ApiKeyCredential = {
    type: "api_key";
    key: string;
};
export type AuthCredential = ApiKeyCredential;
export type AuthStorageData = Record<string, AuthCredential>;
export interface AuthStorageBackend {
    read(): string | undefined;
    write(next: string): void;
}
export declare class FileAuthStorageBackend implements AuthStorageBackend {
    private readonly authPath;
    constructor(authPath?: string);
    read(): string | undefined;
    write(next: string): void;
}
export declare class InMemoryAuthStorageBackend implements AuthStorageBackend {
    private value;
    constructor(value?: string | undefined);
    read(): string | undefined;
    write(next: string): void;
}
export declare class AuthStorage {
    private readonly backend;
    private data;
    private runtimeOverrides;
    private fallbackResolver?;
    private constructor();
    static create(authPath?: string): AuthStorage;
    static inMemory(data?: AuthStorageData): AuthStorage;
    static fromStorage(backend: AuthStorageBackend): AuthStorage;
    reload(): void;
    set(provider: string, credential: AuthCredential): void;
    get(provider: string): AuthCredential | undefined;
    remove(provider: string): void;
    setRuntimeApiKey(provider: string, apiKey: string): void;
    setFallbackResolver(resolver: (provider: string) => string | undefined): void;
    hasAuth(provider: string): boolean;
    getApiKey(provider: string, options?: {
        includeFallback?: boolean;
    }): string | undefined;
    private persist;
    private getEnvApiKey;
}
