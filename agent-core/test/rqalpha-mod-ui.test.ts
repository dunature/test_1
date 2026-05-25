import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("rqalpha runner emits StrategyContext→EventBus→Mod hook metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rqalpha-mod-"));
  try {
    await writeFile(join(dir, "bars.csv"), "datetime,close\n2024-01-01 09:30:00,10\n2024-01-01 09:31:00,11\n2024-01-01 09:32:00,12\n2024-01-01 09:33:00,13\n2024-01-01 09:34:00,14\n2024-01-01 09:35:00,15\n2024-01-01 09:36:00,16\n2024-01-01 09:37:00,17\n2024-01-01 09:38:00,18\n2024-01-01 09:39:00,19\n2024-01-01 09:40:00,20\n2024-01-01 09:41:00,21\n2024-01-01 09:42:00,22\n2024-01-01 09:43:00,23\n2024-01-01 09:44:00,24\n2024-01-01 09:45:00,25\n2024-01-01 09:46:00,26\n2024-01-01 09:47:00,27\n2024-01-01 09:48:00,28\n2024-01-01 09:49:00,29\n2024-01-01 09:50:00,30\n2024-01-01 09:51:00,31\n2024-01-01 09:52:00,32\n2024-01-01 09:53:00,33\n2024-01-01 09:54:00,34\n2024-01-01 09:55:00,35\n2024-01-01 09:56:00,36\n2024-01-01 09:57:00,37\n2024-01-01 09:58:00,38\n2024-01-01 09:59:00,39\n", "utf8");
    await writeFile(join(dir, "strategy.py"), "def init(context):\n    pass\n", "utf8");
    const stdout = await runPython(["sandbox/rqalpha/runner.py", "--strategy", join(dir, "strategy.py"), "--start", "20240101", "--end", "20240101", "--cash", "1000000", "--data", dir]);
    const parsed = JSON.parse(stdout);
    assert.deepEqual(parsed.mod_chain, ["StrategyContext", "EventBus", "sys_simulation", "sys_risk", "sys_analyser"]);
    assert.equal(parsed.mod_events.some((event: any) => event.event === "simulation.before"), true);
    assert.equal(parsed.mod_events.some((event: any) => event.event === "analysis.after"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web UI includes multi-period comparison and drawdown heatmap components", async () => {
  const html = await readFile("public/index.html", "utf8");
  const js = await readFile("public/app.js", "utf8");
  assert.match(html, /id="comparison"/);
  assert.match(html, /id="heatmap"/);
  assert.match(js, /renderComparison/);
  assert.match(js, /renderDrawdownHeatmap/);
  assert.match(js, /backtestRuns/);
});

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.on("error", reject);
  });
}
