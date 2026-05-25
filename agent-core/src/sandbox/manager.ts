import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { safeResolve } from "../safe-path.js";

export interface SandboxPoolConfig {
  maxConcurrent: number;
  memoryMb: number;
  cpus: number;
  timeoutSeconds: number;
}

export interface DockerRunSpec {
  image: string;
  args: string[];
  mounts: Array<{ hostPath: string; containerPath: string; readonly: boolean }>;
  memoryMb: number;
  cpus: number;
  timeoutSeconds: number;
  network: "none";
  readOnlyRootFs: boolean;
  labels?: Record<string, string>;
}

export interface DockerRunner {
  run(spec: DockerRunSpec, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }>;
}

export interface SandboxJob {
  userId: string;
  image: string;
  command: string[];
  files: Array<{ name: string; content: string; containerPath: string }>;
  dataPath?: string;
  timeoutSeconds?: number;
  labels?: Record<string, string>;
}

export interface SandboxRunResult { stdout: string; stderr: string; sandboxId: string; userDataRoot: string }

export class DockerCliRunner implements DockerRunner {
  constructor(private readonly dockerBin = "docker") {}

  run(spec: DockerRunSpec, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    const args = ["run", "--rm", "--network", spec.network, "--memory", `${spec.memoryMb}m`, "--cpus", String(spec.cpus)];
    if (spec.readOnlyRootFs) args.push("--read-only");
    for (const [key, value] of Object.entries(spec.labels ?? {})) args.push("--label", `${key}=${value}`);
    for (const mount of spec.mounts) args.push("-v", `${mount.hostPath}:${mount.containerPath}${mount.readonly ? ":ro" : ""}`);
    args.push(spec.image, ...spec.args);
    return runProcess(this.dockerBin, args, spec.timeoutSeconds * 1000, signal);
  }
}

export class SandboxManager {
  private active = new Set<string>();

  constructor(
    private readonly options: {
      dataRoot: string;
      pool: SandboxPoolConfig;
      runner?: DockerRunner;
    },
  ) {}

  activeCount(): number { return this.active.size; }
  capacity(): number { return this.options.pool.maxConcurrent; }

  async run(job: SandboxJob, signal?: AbortSignal): Promise<SandboxRunResult> {
    if (this.active.size >= this.options.pool.maxConcurrent) {
      throw new Error(`sandbox pool exhausted: ${this.active.size}/${this.options.pool.maxConcurrent} containers active`);
    }

    const sandboxId = crypto.randomUUID();
    this.active.add(sandboxId);
    const workdir = await mkdtemp(join(tmpdir(), `quant-sandbox-${sandboxId}-`));
    try {
      const userDataRoot = await this.resolveUserDataRoot(job.userId, job.dataPath);
      const mounts: DockerRunSpec["mounts"] = [{ hostPath: userDataRoot, containerPath: "/data", readonly: true }];
      for (const file of job.files) {
        const hostPath = safeResolve(workdir, file.name, "sandbox input file");
        await writeFile(hostPath, file.content, "utf8");
        mounts.push({ hostPath, containerPath: file.containerPath, readonly: true });
      }

      const result = await (this.options.runner ?? new DockerCliRunner()).run({
        image: job.image,
        args: job.command,
        mounts,
        memoryMb: this.options.pool.memoryMb,
        cpus: this.options.pool.cpus,
        timeoutSeconds: job.timeoutSeconds ?? this.options.pool.timeoutSeconds,
        network: "none",
        readOnlyRootFs: true,
        labels: { "quant-agent.sandbox-id": sandboxId, "quant-agent.user-id": sanitizeUserId(job.userId), ...job.labels },
      }, signal);
      return { ...result, sandboxId, userDataRoot };
    } finally {
      this.active.delete(sandboxId);
      await rm(workdir, { recursive: true, force: true });
    }
  }

  async resolveUserDataRoot(userId: string, dataPath = "."): Promise<string> {
    const root = resolve(this.options.dataRoot);
    const userRoot = safeResolve(root, sanitizeUserId(userId), "sandbox user data root");
    await mkdir(userRoot, { recursive: true });
    return safeResolve(userRoot, dataPath, "sandbox data path");
  }
}

export function sandboxPoolFromEnv(env = process.env): SandboxPoolConfig {
  return {
    maxConcurrent: readPositiveInt(env.SANDBOX_MAX_CONCURRENT, 8, "SANDBOX_MAX_CONCURRENT"),
    memoryMb: readPositiveInt(env.SANDBOX_MEMORY_MB, 256, "SANDBOX_MEMORY_MB"),
    cpus: readPositiveNumber(env.SANDBOX_CPUS, 1, "SANDBOX_CPUS"),
    timeoutSeconds: readPositiveInt(env.SANDBOX_TIMEOUT_SECONDS, 5, "SANDBOX_TIMEOUT_SECONDS"),
  };
}

export function sanitizeUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed) throw new Error("sandbox userId is required");
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readPositiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function runProcess(cmd: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`sandbox timed out after ${timeoutMs}ms`)); }, timeoutMs);
    const abort = () => { child.kill("SIGKILL"); reject(new Error("sandbox aborted")); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`docker exited ${code}: ${stderr}`));
    });
  });
}
