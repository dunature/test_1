import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
export class FileAuthStorageBackend {
    authPath;
    constructor(authPath = join(process.cwd(), ".agent", "auth.json")) {
        this.authPath = authPath;
    }
    read() {
        if (!existsSync(this.authPath))
            return undefined;
        return readFileSync(this.authPath, "utf8");
    }
    write(next) {
        mkdirSync(dirname(this.authPath), { recursive: true, mode: 0o700 });
        writeFileSync(this.authPath, next, "utf8");
        chmodSync(this.authPath, 0o600);
    }
}
export class InMemoryAuthStorageBackend {
    value;
    constructor(value = undefined) {
        this.value = value;
    }
    read() {
        return this.value;
    }
    write(next) {
        this.value = next;
    }
}
export class AuthStorage {
    backend;
    data = {};
    runtimeOverrides = new Map();
    fallbackResolver;
    constructor(backend) {
        this.backend = backend;
        this.reload();
    }
    static create(authPath) {
        return new AuthStorage(new FileAuthStorageBackend(authPath));
    }
    static inMemory(data = {}) {
        return new AuthStorage(new InMemoryAuthStorageBackend(JSON.stringify(data, null, 2)));
    }
    static fromStorage(backend) {
        return new AuthStorage(backend);
    }
    reload() {
        const raw = this.backend.read();
        this.data = raw ? JSON.parse(raw) : {};
    }
    set(provider, credential) {
        this.data[provider] = credential;
        this.persist();
    }
    get(provider) {
        return this.data[provider];
    }
    remove(provider) {
        delete this.data[provider];
        this.persist();
    }
    setRuntimeApiKey(provider, apiKey) {
        this.runtimeOverrides.set(provider, apiKey);
    }
    setFallbackResolver(resolver) {
        this.fallbackResolver = resolver;
    }
    hasAuth(provider) {
        return Boolean(this.runtimeOverrides.get(provider) ?? this.data[provider] ?? this.getEnvApiKey(provider) ?? this.fallbackResolver?.(provider));
    }
    getApiKey(provider, options = {}) {
        const runtime = this.runtimeOverrides.get(provider);
        if (runtime)
            return runtime;
        const stored = this.data[provider];
        if (stored?.type === "api_key")
            return resolveConfigValue(stored.key);
        const env = this.getEnvApiKey(provider);
        if (env)
            return env;
        if (options.includeFallback !== false)
            return this.fallbackResolver?.(provider);
        return undefined;
    }
    persist() {
        this.backend.write(JSON.stringify(this.data, null, 2));
    }
    getEnvApiKey(provider) {
        const normalized = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
        return process.env[`${normalized}_API_KEY`] ?? process.env["OPENAI_API_KEY"];
    }
}
function resolveConfigValue(value) {
    if (value.startsWith("$")) {
        const envName = value.slice(1);
        const envValue = process.env[envName];
        if (!envValue)
            throw new Error(`Missing environment variable ${envName}`);
        return envValue;
    }
    return value;
}
