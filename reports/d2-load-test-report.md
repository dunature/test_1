# D2 50 并发压测报告

## 结论

当前 workspace 已补齐 D2 压测入口和部署配置，但本环境没有 Docker CLI，也没有目标服务器/域名/端口，因此尚未执行真实 50 并发压测。真实压测需在目标 Docker 主机上执行。

## 验收口径（demo 版）

- 50 并发 WebSocket 连接持续 5 分钟
- 错误率 `<1%`
- WebSocket 断连自动恢复成功率 `>=95%`
- kill 后 30s 内恢复
- P95 连接/交互延迟 `<2s`
- session 不串线

## 已交付配置

| 项 | 文件 | 说明 |
| --- | --- | --- |
| PM2 cluster | `ecosystem.config.cjs` | `exec_mode=cluster`，`instances=max`，崩溃自动重启，日志写 `/var/log/quant-agent` |
| nginx reverse proxy | `nginx.conf` | `/ws` 支持 WebSocket upgrade，`ip_hash` sticky，`/healthz` 转发 |
| Compose 编排 | `docker-compose.yml` | `agent + nginx`，挂载 `/var/run/docker.sock`，healthcheck gating |
| 压测脚本 | `scripts/ws-load-test.mjs` | 默认 50 并发、5 分钟、错误/断连阈值 1%、P95 2s |
| 健康检查 | `agent-core/src/bridge/websocket-bridge.ts` | `GET /healthz` 返回 `status`、`uptime_seconds`、`active_ws_clients`、`attached_sessions` |

## 目标环境执行命令

```bash
export DEEPSEEK_API_KEY="..."
export TUSHARE_TOKEN="..."
docker compose up --build -d
curl -fsS http://127.0.0.1:${HTTP_PORT:-80}/healthz
node scripts/ws-load-test.mjs ws://127.0.0.1:${HTTP_PORT:-80}/ws 50 300000
```

## 当前 workspace 验证

- `npm run typecheck`：通过
- `npm test -- --runInBand`：27/27 通过
- `npm run build`：通过
- 本地 Node server `/healthz`：通过
- `docker compose up --build`：未执行，原因是 workspace 无 `docker` CLI
