import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SandboxManager } from "../src/index.js";
class CapturingRunner {
    hold;
    specs = [];
    constructor(hold) {
        this.hold = hold;
    }
    async run(spec) {
        this.specs.push(spec);
        await this.hold;
        return { stdout: JSON.stringify({ equity_curve: [], metrics: { sharpe: 0, max_drawdown: 0, win_rate: 0, annual_return: 0 } }), stderr: "" };
    }
}
test("SandboxManager enforces max concurrent container leases", async () => {
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const runner = new CapturingRunner(hold);
    const dir = await mkdtemp(join(tmpdir(), "sandbox-pool-"));
    const manager = new SandboxManager({ dataRoot: dir, pool: { maxConcurrent: 1, memoryMb: 128, cpus: 0.5, timeoutSeconds: 2 }, runner });
    const first = manager.run({ userId: "u1", image: "img", command: ["true"], files: [] });
    await assert.rejects(manager.run({ userId: "u2", image: "img", command: ["true"], files: [] }), /sandbox pool exhausted: 1\/1/);
    release();
    await first;
    assert.equal(manager.activeCount(), 0);
    await rm(dir, { recursive: true, force: true });
});
test("SandboxManager isolates user data roots and rejects traversal", async () => {
    const runner = new CapturingRunner();
    const dir = await mkdtemp(join(tmpdir(), "sandbox-users-"));
    const manager = new SandboxManager({ dataRoot: dir, pool: { maxConcurrent: 2, memoryMb: 256, cpus: 1, timeoutSeconds: 5 }, runner });
    const a = await manager.run({ userId: "user/a", image: "img", command: ["true"], files: [{ name: "strategy.py", content: "print(1)", containerPath: "/workspace/strategy.py" }] });
    const b = await manager.run({ userId: "user-b", image: "img", command: ["true"], files: [] });
    assert.notEqual(a.userDataRoot, b.userDataRoot);
    assert.match(a.userDataRoot, /user_a/);
    assert.match(b.userDataRoot, /user-b/);
    await assert.rejects(manager.run({ userId: "user-a", image: "img", command: ["true"], files: [], dataPath: "../user-b" }), /escapes root/);
    await rm(dir, { recursive: true, force: true });
});
test("SandboxManager passes Docker resource and lifecycle constraints to runner", async () => {
    const runner = new CapturingRunner();
    const dir = await mkdtemp(join(tmpdir(), "sandbox-spec-"));
    const manager = new SandboxManager({ dataRoot: dir, pool: { maxConcurrent: 2, memoryMb: 512, cpus: 2, timeoutSeconds: 9 }, runner });
    await manager.run({ userId: "u", image: "rqalpha", command: ["python", "/runner.py"], files: [] });
    const spec = runner.specs[0];
    assert.equal(spec.memoryMb, 512);
    assert.equal(spec.cpus, 2);
    assert.equal(spec.timeoutSeconds, 9);
    assert.equal(spec.network, "none");
    assert.equal(spec.readOnlyRootFs, true);
    assert.equal(spec.labels?.["quant-agent.user-id"], "u");
    await rm(dir, { recursive: true, force: true });
});
