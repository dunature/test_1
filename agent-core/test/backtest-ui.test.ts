import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createBacktestTool, ToolRegistry } from "../src/index.js";

test("backtest tool returns structured equity curve and metrics from replaceable sandbox operations", async () => {
  const registry = new ToolRegistry();
  registry.register(createBacktestTool({
    async runBacktest(params) {
      assert.equal(params.timeout_seconds, 60);
      return {
        equity_curve: [{ date: "2024-01-01", equity: 1000000 }, { date: "2024-01-02", equity: 1010000 }],
        metrics: { sharpe: 1.2, max_drawdown: -0.03, win_rate: 0.55, annual_return: 0.18 },
      };
    },
  }));
  const result = await registry.execute({ id: "b", name: "backtest", arguments: { strategy_code: "def init(context): pass", start_date: "20240101", end_date: "20240102" } });
  assert.equal(result.isError, false);
  assert.equal((result.result?.details as any).engine, "rqalpha");
  assert.equal((result.result?.details as any).memory_mb, 256);
  assert.equal((result.result?.details as any).network, "none");
  assert.match(result.result?.content[0]?.type === "text" ? result.result.content[0].text : "", /equity_curve/);
});

test("web UI includes backtest canvas, metrics table and reconnect logic", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");
  assert.match(html, /<canvas id="equity"/);
  assert.match(html, /<table id="metrics"/);
  assert.match(js, /setTimeout\(connect,1000\)/);
  assert.match(js, /renderBacktest/);
  assert.match(js, /drawEquity/);
});
