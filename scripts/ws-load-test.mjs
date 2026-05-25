#!/usr/bin/env node
import assert from "node:assert/strict";

const target = process.env.WS_URL ?? process.argv[2] ?? "ws://127.0.0.1/ws";
const concurrency = Number(process.env.CONCURRENCY ?? process.argv[3] ?? "50");
const durationMs = Number(process.env.DURATION_MS ?? process.argv[4] ?? "300000");
const maxDisconnectRate = Number(process.env.MAX_DISCONNECT_RATE ?? "0.01");
const maxErrorRate = Number(process.env.MAX_ERROR_RATE ?? "0.01");
const maxConnectP95Ms = Number(process.env.MAX_CONNECT_P95_MS ?? "2000");
const sendMessages = (process.env.SEND_MESSAGES ?? "false") === "true";

assert.ok(Number.isInteger(concurrency) && concurrency > 0, "CONCURRENCY must be a positive integer");
assert.ok(Number.isInteger(durationMs) && durationMs > 0, "DURATION_MS must be a positive integer");

let connected = 0;
let errors = 0;
let unexpectedDisconnects = 0;
let closing = false;
const connectLatencies = [];
const sockets = [];

await Promise.all(Array.from({ length: concurrency }, (_, index) => new Promise((resolve, reject) => {
  const startedAt = performance.now();
  const socket = new WebSocket(target);
  const timer = setTimeout(() => reject(new Error(`client ${index} connect timeout`)), 5000);
  socket.addEventListener("open", () => {
    clearTimeout(timer);
    connected += 1;
    connectLatencies.push(performance.now() - startedAt);
    if (sendMessages) socket.send(JSON.stringify({ type: "message", text: `load-test-${index}` }));
    resolve();
  }, { once: true });
  socket.addEventListener("close", () => { if (!closing) unexpectedDisconnects += 1; });
  socket.addEventListener("error", () => { errors += 1; });
  sockets.push(socket);
})));

await new Promise((resolve) => setTimeout(resolve, durationMs));

const disconnectRate = unexpectedDisconnects / concurrency;
const errorRate = errors / concurrency;
const connectP95Ms = percentile(connectLatencies, 0.95);
const passed = connected === concurrency
  && disconnectRate <= maxDisconnectRate
  && errorRate <= maxErrorRate
  && connectP95Ms <= maxConnectP95Ms;
const result = {
  target,
  concurrency,
  duration_ms: durationMs,
  send_messages: sendMessages,
  connected,
  errors,
  unexpected_disconnects: unexpectedDisconnects,
  disconnect_rate: disconnectRate,
  max_disconnect_rate: maxDisconnectRate,
  error_rate: errorRate,
  max_error_rate: maxErrorRate,
  connect_p95_ms: Math.round(connectP95Ms),
  max_connect_p95_ms: maxConnectP95Ms,
  passed,
};
console.log(JSON.stringify(result, null, 2));

closing = true;
for (const socket of sockets) socket.close();

process.exit(passed ? 0 : 1);

function percentile(values, p) {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}
