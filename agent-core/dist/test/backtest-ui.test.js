import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createBacktestTool, createDockerRqalphaOperations, ToolRegistry } from "../src/index.js";
test("backtest tool returns structured equity curve and metrics from replaceable sandbox operations", async () => {
    const registry = new ToolRegistry();
    registry.register(createBacktestTool({
        async runBacktest(params) {
            assert.equal(params.timeout_seconds, 5);
            return {
                equity_curve: [{ date: "2024-01-01", equity: 1000000 }, { date: "2024-01-02", equity: 1010000 }],
                metrics: { sharpe: 1.2, max_drawdown: -0.03, win_rate: 0.55, annual_return: 0.18 },
            };
        },
    }));
    const result = await registry.execute({ id: "b", name: "backtest", arguments: { strategy_code: "def init(context): pass", start_date: "20240101", end_date: "20240102" } });
    assert.equal(result.isError, false);
    assert.equal((result.result?.details).engine, "rqalpha");
    assert.equal((result.result?.details).memory_mb, 256);
    assert.equal((result.result?.details).network, "none");
    assert.match(result.result?.content[0]?.type === "text" ? result.result.content[0].text : "", /equity_curve/);
});
test("web UI includes backtest canvas, metrics table and reconnect logic", async () => {
    const html = await readFile("public/index.html", "utf8");
    const js = await readFile("public/app.js", "utf8");
    assert.match(html, /<canvas id="equity"/);
    assert.match(html, /<table id="metrics"/);
    assert.match(js, /setTimeout\(connect,1000\)/);
    assert.match(js, /\/ws/);
    assert.match(js, /renderBacktest/);
    assert.match(js, /drawEquity/);
});
test("rqalpha runner consumes mounted CSV data instead of synthetic results", async () => {
    const runner = await readFile("sandbox/rqalpha/runner.py", "utf8");
    assert.match(runner, /csv\.DictReader/);
    assert.match(runner, /load_bars\(args\.data\)/);
    assert.match(runner, /run_double_ma_backtest/);
    assert.doesNotMatch(runner, /synthetic_result/);
});
test("docker rqalpha operations reject data paths outside configured data root", async () => {
    const operations = createDockerRqalphaOperations({ dataRoot: "/workspace/data", dockerBin: "docker" });
    await assert.rejects(operations.runBacktest({
        strategy_code: "def init(context): pass",
        start_date: "20240101",
        end_date: "20240102",
        initial_cash: 1_000_000,
        timeout_seconds: 5,
        data_path: "../secret",
    }), /escapes root/);
});
test("backtest tool rejects user-supplied host data_path", async () => {
    const registry = new ToolRegistry();
    registry.register(createBacktestTool({
        async runBacktest() {
            throw new Error("should not execute with invalid schema");
        },
    }));
    const result = await registry.execute({
        id: "b",
        name: "backtest",
        arguments: {
            strategy_code: "def init(context): pass",
            start_date: "20240101",
            end_date: "20240102",
            data_path: "../secret",
        },
    });
    assert.equal(result.isError, true);
    assert.match(result.error ?? "", /unknown argument: data_path/);
});
test("backtest tool rejects caller-supplied user_id and injects server-side identity", async () => {
    let capturedUserId;
    const registry = new ToolRegistry();
    registry.register(createBacktestTool({
        async runBacktest(params) {
            capturedUserId = params.user_id;
            return {
                equity_curve: [],
                metrics: { sharpe: 0, max_drawdown: 0, win_rate: 0, annual_return: 0 },
            };
        },
    }, { userId: "server-session" }));
    const rejected = await registry.execute({
        id: "b",
        name: "backtest",
        arguments: {
            strategy_code: "def init(context): pass",
            start_date: "20240101",
            end_date: "20240102",
            user_id: "victim",
        },
    });
    assert.equal(rejected.isError, true);
    assert.match(rejected.error ?? "", /unknown argument: user_id/);
    const accepted = await registry.execute({
        id: "b",
        name: "backtest",
        arguments: {
            strategy_code: "def init(context): pass",
            start_date: "20240101",
            end_date: "20240102",
        },
    });
    assert.equal(accepted.isError, false);
    assert.equal(capturedUserId, "server-session");
});
test("backtest tool supports dynamic server-side identity per session", async () => {
    const captured = [];
    let currentSessionId = "client-a";
    const registry = new ToolRegistry();
    registry.register(createBacktestTool({
        async runBacktest(params) {
            captured.push(params.user_id);
            return {
                equity_curve: [],
                metrics: { sharpe: 0, max_drawdown: 0, win_rate: 0, annual_return: 0 },
            };
        },
    }, { userId: () => currentSessionId }));
    const args = { strategy_code: "def init(context): pass", start_date: "20240101", end_date: "20240102" };
    await registry.execute({ id: "a", name: "backtest", arguments: args });
    currentSessionId = "client-b";
    await registry.execute({ id: "b", name: "backtest", arguments: args });
    assert.deepEqual(captured, ["client-a", "client-b"]);
});
