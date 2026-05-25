import { type AgentTool } from "../index.js";
import { type DockerRunner, type SandboxPoolConfig } from "../../sandbox/index.js";
export interface BacktestParams {
    strategy_code: string;
    start_date: string;
    end_date: string;
    initial_cash?: number;
    benchmark?: string;
    data_path?: string;
    timeout_seconds?: number;
}
export interface EquityPoint {
    date: string;
    equity: number;
}
export interface BacktestMetrics {
    sharpe: number;
    max_drawdown: number;
    win_rate: number;
    annual_return: number;
}
export interface BacktestResult {
    equity_curve: EquityPoint[];
    metrics: BacktestMetrics;
    stdout?: string;
    stderr?: string;
    sandbox_id?: string;
    user_data_root?: string;
}
export interface BacktestDetails extends BacktestResult {
    engine: "rqalpha";
    timeout_seconds: number;
    memory_mb: number;
    network: "none";
    sandbox_pool: {
        max_concurrent: number;
        active: number;
    };
}
export interface BacktestOperations {
    runBacktest(params: Required<Omit<BacktestParams, "benchmark" | "data_path">> & Pick<BacktestParams, "benchmark" | "data_path"> & {
        user_id?: string;
    }): Promise<BacktestResult>;
}
export interface BacktestToolOptions {
    userId?: string | (() => string);
}
export declare function createDockerRqalphaOperations(options?: {
    image?: string;
    dataRoot?: string;
    dataPath?: string;
    dockerBin?: string;
    pool?: Partial<SandboxPoolConfig>;
    runner?: DockerRunner;
}): BacktestOperations;
export declare function createBacktestTool(operations: BacktestOperations, options?: BacktestToolOptions): AgentTool<BacktestParams, BacktestDetails, BacktestOperations>;
