import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const defaultConfig = {
    providers: {
        openai: {
            name: "OpenAI",
            baseUrl: "https://api.openai.com/v1",
            models: [
                {
                    id: "gpt-4.1-mini",
                    name: "GPT-4.1 mini",
                    contextWindow: 1_000_000,
                    maxOutputTokens: 32_768,
                    input: ["text", "image"],
                    supportsTools: true,
                },
            ],
        },
    },
};
export class ModelRegistry {
    authStorage;
    modelsJsonPath;
    models = [];
    providerConfigs = new Map();
    modelHeaders = new Map();
    loadError;
    constructor(authStorage, modelsJsonPath) {
        this.authStorage = authStorage;
        this.modelsJsonPath = modelsJsonPath;
        this.refresh();
    }
    static create(authStorage, modelsJsonPath = join(process.cwd(), ".agent", "models.json")) {
        return new ModelRegistry(authStorage, modelsJsonPath);
    }
    static inMemory(authStorage, config = defaultConfig) {
        const registry = new ModelRegistry(authStorage, undefined);
        registry.loadFromConfig(config);
        return registry;
    }
    refresh() {
        this.loadError = undefined;
        this.loadFromConfig(defaultConfig);
        if (!this.modelsJsonPath || !existsSync(this.modelsJsonPath))
            return;
        try {
            const parsed = JSON.parse(stripJsonComments(readFileSync(this.modelsJsonPath, "utf8")));
            this.validateConfig(parsed);
            this.loadFromConfig(parsed);
        }
        catch (error) {
            this.loadError = error instanceof Error ? error.message : String(error);
        }
    }
    getError() {
        return this.loadError;
    }
    getAll() {
        return [...this.models];
    }
    getAvailable() {
        return this.models.filter((model) => this.authStorage.hasAuth(model.provider) || Boolean(this.providerConfigs.get(model.provider)?.apiKey));
    }
    find(provider, modelId) {
        return this.models.find((model) => model.provider === provider && model.id === modelId);
    }
    registerProvider(provider, config) {
        this.validateProvider(provider, config);
        this.upsertProvider(provider, config);
    }
    async getAuthForModel(model) {
        try {
            const config = this.providerConfigs.get(model.provider);
            const apiKey = this.authStorage.getApiKey(model.provider) ?? resolveConfigValue(config?.apiKey);
            const headers = mergeHeaders(model.headers, config?.headers, this.modelHeaders.get(modelKey(model.provider, model.id)));
            const auth = {};
            if (apiKey !== undefined)
                auth.apiKey = apiKey;
            if (headers !== undefined)
                auth.headers = headers;
            return { ok: true, auth };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    loadFromConfig(config) {
        this.models = [];
        this.providerConfigs.clear();
        this.modelHeaders.clear();
        for (const [provider, providerConfig] of Object.entries(config.providers)) {
            this.upsertProvider(provider, providerConfig);
        }
    }
    upsertProvider(provider, providerConfig) {
        this.validateProvider(provider, providerConfig);
        this.providerConfigs.set(provider, providerConfig);
        this.models = this.models.filter((model) => model.provider !== provider);
        for (const model of providerConfig.models) {
            if (model.headers)
                this.modelHeaders.set(modelKey(provider, model.id), model.headers);
            this.models.push({
                provider,
                id: model.id,
                name: model.name ?? model.id,
                api: "openai-compatible",
                baseUrl: trimTrailingSlash(providerConfig.baseUrl),
                contextWindow: model.contextWindow ?? 128_000,
                maxOutputTokens: model.maxOutputTokens ?? 16_384,
                input: model.input ?? ["text"],
                supportsTools: model.supportsTools ?? true,
            });
        }
    }
    validateConfig(config) {
        if (!config.providers || typeof config.providers !== "object")
            throw new Error("models config requires providers");
        for (const [provider, providerConfig] of Object.entries(config.providers))
            this.validateProvider(provider, providerConfig);
    }
    validateProvider(provider, providerConfig) {
        if (!provider)
            throw new Error("provider id is required");
        if (!providerConfig.baseUrl)
            throw new Error(`provider ${provider} requires baseUrl`);
        if (!Array.isArray(providerConfig.models) || providerConfig.models.length === 0) {
            throw new Error(`provider ${provider} requires at least one model`);
        }
        for (const model of providerConfig.models) {
            if (!model.id)
                throw new Error(`provider ${provider} has model without id`);
        }
    }
}
function modelKey(provider, modelId) {
    return `${provider}:${modelId}`;
}
function trimTrailingSlash(url) {
    return url.replace(/\/+$/, "");
}
function mergeHeaders(...headers) {
    const merged = Object.assign({}, ...headers.filter(Boolean));
    return Object.keys(merged).length > 0 ? merged : undefined;
}
function resolveConfigValue(value) {
    if (!value)
        return undefined;
    if (value.startsWith("$")) {
        const envName = value.slice(1);
        const envValue = process.env[envName];
        if (!envValue)
            throw new Error(`Missing environment variable ${envName}`);
        return envValue;
    }
    return value;
}
function stripJsonComments(input) {
    return input
        .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => (match.startsWith('"') ? match : ""))
        .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail) => tail ?? (match.startsWith('"') ? match : ""));
}
