import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

export type ApiKeyCredential = { type: "api_key"; key: string };
export type AuthCredential = ApiKeyCredential;
export type AuthStorageData = Record<string, AuthCredential>;

export interface AuthStorageBackend {
  read(): string | undefined;
  write(next: string): void;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
  constructor(private readonly authPath = join(process.cwd(), ".agent", "auth.json")) {}

  read(): string | undefined {
    if (!existsSync(this.authPath)) return undefined;
    return readFileSync(this.authPath, "utf8");
  }

  write(next: string): void {
    mkdirSync(dirname(this.authPath), { recursive: true, mode: 0o700 });
    writeFileSync(this.authPath, next, "utf8");
    chmodSync(this.authPath, 0o600);
  }
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
  constructor(private value: string | undefined = undefined) {}
  read(): string | undefined {
    return this.value;
  }
  write(next: string): void {
    this.value = next;
  }
}

export class AuthStorage {
  private data: AuthStorageData = {};
  private runtimeOverrides = new Map<string, string>();
  private fallbackResolver?: (provider: string) => string | undefined;

  private constructor(private readonly backend: AuthStorageBackend) {
    this.reload();
  }

  static create(authPath?: string): AuthStorage {
    return new AuthStorage(new FileAuthStorageBackend(authPath));
  }

  static inMemory(data: AuthStorageData = {}): AuthStorage {
    return new AuthStorage(new InMemoryAuthStorageBackend(JSON.stringify(data, null, 2)));
  }

  static fromStorage(backend: AuthStorageBackend): AuthStorage {
    return new AuthStorage(backend);
  }

  reload(): void {
    const raw = this.backend.read();
    this.data = raw ? (JSON.parse(raw) as AuthStorageData) : {};
  }

  set(provider: string, credential: AuthCredential): void {
    this.data[provider] = credential;
    this.persist();
  }

  get(provider: string): AuthCredential | undefined {
    return this.data[provider];
  }

  remove(provider: string): void {
    delete this.data[provider];
    this.persist();
  }

  setRuntimeApiKey(provider: string, apiKey: string): void {
    this.runtimeOverrides.set(provider, apiKey);
  }

  setFallbackResolver(resolver: (provider: string) => string | undefined): void {
    this.fallbackResolver = resolver;
  }

  hasAuth(provider: string): boolean {
    return Boolean(this.runtimeOverrides.get(provider) ?? this.data[provider] ?? this.getEnvApiKey(provider) ?? this.fallbackResolver?.(provider));
  }

  getApiKey(provider: string, options: { includeFallback?: boolean } = {}): string | undefined {
    const runtime = this.runtimeOverrides.get(provider);
    if (runtime) return runtime;

    const stored = this.data[provider];
    if (stored?.type === "api_key") return resolveConfigValue(stored.key);

    const env = this.getEnvApiKey(provider);
    if (env) return env;

    if (options.includeFallback !== false) return this.fallbackResolver?.(provider);
    return undefined;
  }

  private persist(): void {
    this.backend.write(JSON.stringify(this.data, null, 2));
  }

  private getEnvApiKey(provider: string): string | undefined {
    const normalized = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return process.env[`${normalized}_API_KEY`] ?? process.env["OPENAI_API_KEY"];
  }
}

function resolveConfigValue(value: string): string {
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    const envValue = process.env[envName];
    if (!envValue) throw new Error(`Missing environment variable ${envName}`);
    return envValue;
  }
  return value;
}
