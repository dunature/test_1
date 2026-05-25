import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { defineTool, type AgentTool } from "../index.js";

export interface BacktestParams { strategy_code: string; start_date: string; end_date: string; initial_cash?: number; benchmark?: string; data_path?: string; timeout_seconds?: number }
export interface EquityPoint { date: string; equity: number }
export interface BacktestMetrics { sharpe: number; max_drawdown: number; win_rate: number; annual_return: number }
export interface BacktestResult { equity_curve: EquityPoint[]; metrics: BacktestMetrics; stdout?: string; stderr?: string }
export interface BacktestDetails extends BacktestResult { engine: "rqalpha"; timeout_seconds: number; memory_mb: number; network: "none" }
export interface BacktestOperations { runBacktest(params: Required<Omit<BacktestParams, "benchmark" | "data_path">> & Pick<BacktestParams, "benchmark" | "data_path">): Promise<BacktestResult> }

export function createDockerRqalphaOperations(options: { image?: string; dataPath?: string; dockerBin?: string } = {}): BacktestOperations {
  const image = options.image ?? "quant-agent-rqalpha:latest";
  const dockerBin = options.dockerBin ?? "docker";
  return { async runBacktest(params) {
    const workdir = await mkdtemp(join(tmpdir(), "rqalpha-backtest-"));
    try {
      const strategyPath = join(workdir, "strategy.py");
      await writeFile(strategyPath, params.strategy_code, "utf8");
      const args = ["run", "--rm", "--network", "none", "--memory", "256m", "--cpus", "1", "--read-only", "-v", `${strategyPath}:/workspace/strategy.py:ro`];
      const dataPath = params.data_path ?? options.dataPath;
      if (dataPath) args.push("-v", `${resolve(dataPath)}:/data:ro`);
      args.push(image, "python", "/runner.py", "--strategy", "/workspace/strategy.py", "--start", params.start_date, "--end", params.end_date, "--cash", String(params.initial_cash));
      if (params.benchmark) args.push("--benchmark", params.benchmark);
      const { stdout, stderr } = await runProcess(dockerBin, args, params.timeout_seconds * 1000);
      const parsed = JSON.parse(stdout) as BacktestResult;
      return { ...parsed, stdout, stderr };
    } finally { await rm(workdir, { recursive: true, force: true }); }
  } };
}

export function createBacktestTool(operations: BacktestOperations): AgentTool<BacktestParams, BacktestDetails, BacktestOperations> {
  return defineTool<BacktestParams, BacktestDetails, BacktestOperations>({
    name: "backtest",
    description: "Run an rqalpha strategy in a Docker sandbox and return structured equity curve plus metrics JSON.",
    parameters: { type: "object", properties: { strategy_code: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, initial_cash: { type: "number" }, benchmark: { type: "string" }, data_path: { type: "string" }, timeout_seconds: { type: "integer" } }, required: ["strategy_code", "start_date", "end_date"], additionalProperties: false },
    operations,
    async execute({ params, operations }) {
      const timeout_seconds = params.timeout_seconds ?? 60;
      const result = await operations!.runBacktest({ ...params, initial_cash: params.initial_cash ?? 1_000_000, timeout_seconds });
      const details: BacktestDetails = { ...result, engine: "rqalpha", timeout_seconds, memory_mb: 256, network: "none" };
      return { content: [{ type: "text", text: JSON.stringify({ equity_curve: result.equity_curve, metrics: result.metrics }, null, 2) }], details };
    },
    renderCall: (p) => `backtest ${p.start_date}..${p.end_date}`,
    renderResult: (r) => `Sharpe ${r.details.metrics.sharpe}, max drawdown ${r.details.metrics.max_drawdown}`,
  });
}

function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`backtest timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`docker exited ${code}: ${stderr}`)); });
  });
}
