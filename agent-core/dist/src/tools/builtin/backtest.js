import { resolve } from "node:path";
import { defineTool } from "../index.js";
import { SandboxManager, sandboxPoolFromEnv } from "../../sandbox/index.js";
export function createDockerRqalphaOperations(options = {}) {
    const image = options.image ?? "quant-agent-rqalpha:latest";
    const dataRoot = resolve(options.dataRoot ?? process.cwd());
    const pool = { ...sandboxPoolFromEnv(), ...options.pool };
    const managerOptions = { dataRoot, pool };
    if (options.runner !== undefined)
        managerOptions.runner = options.runner;
    const manager = new SandboxManager(managerOptions);
    return { async runBacktest(params) {
            const dataPath = params.data_path ?? options.dataPath ?? ".";
            const run = await manager.run({
                userId: params.user_id ?? "default",
                image,
                files: [{ name: "strategy.py", content: params.strategy_code, containerPath: "/workspace/strategy.py" }],
                dataPath,
                timeoutSeconds: params.timeout_seconds,
                command: ["python", "/runner.py", "--strategy", "/workspace/strategy.py", "--start", params.start_date, "--end", params.end_date, "--cash", String(params.initial_cash), "--data", "/data", ...(params.benchmark ? ["--benchmark", params.benchmark] : [])],
                labels: { "quant-agent.job": "rqalpha-backtest" },
            });
            const parsed = JSON.parse(run.stdout);
            return { ...parsed, stdout: run.stdout, stderr: run.stderr, sandbox_id: run.sandboxId, user_data_root: run.userDataRoot };
        } };
}
export function createBacktestTool(operations, options = {}) {
    return defineTool({
        name: "backtest",
        description: "Run an rqalpha strategy in a per-user Docker sandbox and return structured equity curve plus metrics JSON.",
        parameters: { type: "object", properties: { strategy_code: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, initial_cash: { type: "number" }, benchmark: { type: "string" }, timeout_seconds: { type: "integer" } }, required: ["strategy_code", "start_date", "end_date"], additionalProperties: false },
        operations,
        async execute({ params, operations }) {
            const timeout_seconds = params.timeout_seconds ?? 5;
            const { data_path: _ignored, ...safeParams } = params;
            const user_id = typeof options.userId === "function" ? options.userId() : options.userId;
            const result = await operations.runBacktest({ ...safeParams, initial_cash: params.initial_cash ?? 1_000_000, timeout_seconds, user_id: user_id ?? "default" });
            const details = { ...result, engine: "rqalpha", timeout_seconds, memory_mb: sandboxPoolFromEnv().memoryMb, network: "none", sandbox_pool: { max_concurrent: sandboxPoolFromEnv().maxConcurrent, active: 0 } };
            return { content: [{ type: "text", text: JSON.stringify({ equity_curve: result.equity_curve, metrics: result.metrics }, null, 2) }], details };
        },
        renderCall: (p) => `backtest ${p.start_date}..${p.end_date}`,
        renderResult: (r) => `Sharpe ${r.details.metrics.sharpe}, max drawdown ${r.details.metrics.max_drawdown}`,
    });
}
