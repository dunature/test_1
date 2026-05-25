export interface SandboxPoolConfig {
    maxConcurrent: number;
    memoryMb: number;
    cpus: number;
    timeoutSeconds: number;
}
export interface DockerRunSpec {
    image: string;
    args: string[];
    mounts: Array<{
        hostPath: string;
        containerPath: string;
        readonly: boolean;
    }>;
    memoryMb: number;
    cpus: number;
    timeoutSeconds: number;
    network: "none";
    readOnlyRootFs: boolean;
    labels?: Record<string, string>;
}
export interface DockerRunner {
    run(spec: DockerRunSpec, signal?: AbortSignal): Promise<{
        stdout: string;
        stderr: string;
    }>;
}
export interface SandboxJob {
    userId: string;
    image: string;
    command: string[];
    files: Array<{
        name: string;
        content: string;
        containerPath: string;
    }>;
    dataPath?: string;
    timeoutSeconds?: number;
    labels?: Record<string, string>;
}
export interface SandboxRunResult {
    stdout: string;
    stderr: string;
    sandboxId: string;
    userDataRoot: string;
}
export declare class DockerCliRunner implements DockerRunner {
    private readonly dockerBin;
    constructor(dockerBin?: string);
    run(spec: DockerRunSpec, signal?: AbortSignal): Promise<{
        stdout: string;
        stderr: string;
    }>;
}
export declare class SandboxManager {
    private readonly options;
    private active;
    constructor(options: {
        dataRoot: string;
        pool: SandboxPoolConfig;
        runner?: DockerRunner;
    });
    activeCount(): number;
    capacity(): number;
    run(job: SandboxJob, signal?: AbortSignal): Promise<SandboxRunResult>;
    resolveUserDataRoot(userId: string, dataPath?: string): Promise<string>;
}
export declare function sandboxPoolFromEnv(env?: NodeJS.ProcessEnv): SandboxPoolConfig;
export declare function sanitizeUserId(userId: string): string;
