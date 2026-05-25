# Quant Agent — 网页端量化策略开发智能体

## 项目概述

Quant Agent 是一个在网页端运行的 AI 智能体，专为量化策略研究员设计。它能够接收用户的自然语言策略需求，自动完成：数据拉取 → 策略代码生成 → 沙箱回测执行 → 结果可视化展示的完整闭环。

**核心价值**：让研究员用一句话描述策略思路，Agent 自动完成从数据到回测结果的全流程，并在 Web 界面实时展示每一步的进度和结果。

**目标用户**：专业量化研究员，熟悉 Python 和量化策略开发流程。

**当前状态**：Phase 1 + Demo 增强代码层已完成（26/26 测试全绿，PR #1 + PR #2）。D1/D2 部署和 D6 真实数据端到端验收进行中。Phase 2 规划中。

---

## 架构概览

Quant Agent 采用三层架构，设计理念参考 Pi（最小可控内核）和 Claude Code（工业级产品层）：

```
┌─────────────────────────────────────────────┐
│ Web UI 层                                   │
│ 对话面板 · 策略代码高亮 · 回测面板           │
│ 权益曲线 · 策略指标 · WebSocket 实时事件     │
└──────────────────┬──────────────────────────┘
                   │ WebSocket / SSE
┌──────────────────┴──────────────────────────┐
│ Product 层                                  │
│ 工具权限 · 执行隔离 · 错误恢复 · 上下文治理  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│ Core 层                                     │
│ Agent Loop · Provider Adapter · Tool Registry│
│ JSONL Session Tree · Event Stream           │
└─────────────────────────────────────────────┘
```

### Core 层（参考 Pi 设计）
- **Agent Loop**：简洁的事件驱动循环，assistant → tool call → execute → result → next turn
- **Provider Adapter**：LLM 供应商抽象层，当前支持 DeepSeek（OpenAI-compatible）
- **JSONL Session Tree**：id/parentId/leafId 树形会话存储，支持分支、回溯、压缩
- **Event Stream**：agent_start/turn_start/tool_execution_update/message_delta 等事件通过 WebSocket 实时推送

### Product 层（参考 Claude Code 设计）
- **执行隔离**：策略代码在 Docker 容器内运行（5s 超时、256MB 内存、无网络出站）
- **工具安全**：safeResolve 路径边界校验、data_path 用户不可控、凭据不进前端/日志/容器
- **错误恢复**：外部 API 60s 超时 + 明确错误提示，WebSocket 断连自动重连

### Web UI 层
- 对话面板：策略需求输入和历史展示
- 回测面板：Canvas 权益曲线 + 策略指标表格（夏普比率、最大回撤、胜率、年化收益）
- 实时事件流：工具调用状态、数据拉取进度、代码生成过程

---

## 技术栈

| 层次 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js ≥18 | TypeScript 实现 |
| LLM 供应商 | DeepSeek（deepseek-v4-pro） | OpenAI-compatible API |
| 数据源 | Tushare 标准 API（stk_mins） | A 股分钟级历史数据 |
| 策略回测 | rqalpha + numpy | Docker 容器内隔离执行 |
| 部署 | Docker + nginx + PM2 | 50 用户并发支持 |
| 会话存储 | JSONL Tree | 可分支、可回溯、可审计 |

---

## 开发路线图

### ✅ Phase 1 — 核心引擎（已完成）
- [x] Provider adapter（DeepSeek 接入）
- [x] Agent loop（事件驱动）
- [x] Tool registry + 内置工具（read/edit/write/fetch_data/load_resource）
- [x] JSONL session tree（分支/回溯）
- [x] WebSocket bridge（事件推送）
- [x] Web UI 基础面板
- [x] Content Ingestion Pipeline（多来源内容接收）

### ✅ Demo 增强（已完成）
- [x] Tushare 标准 API 数据层（stk_mins，分钟级 A 股数据）
- [x] rqalpha 策略模板（双均线 10min/30min 交叉）
- [x] Docker sandbox 回测执行（5s 超时、256MB 内存、无网络隔离）
- [x] Web UI 回测面板（权益曲线 + 指标表格 + WebSocket 重连）
- [x] PR #1 和 PR #2 代码层评审+QA 通过（26/26 测试全绿）
- [ ] D6 E2E：真实 Tushare token 注入后 600519 端到端（待 token 安全注入）
- [ ] D6 压测：50 并发 + WebSocket 断连恢复（待 D1/D2 部署环境）

### 🔜 Phase 2a — 回测 + 基础安全（规划中）
- [ ] 完整 rqalpha 回测引擎集成（Mod 插件化）
- [ ] Python sandbox 正式化（Docker 编排、多用户隔离）
- [ ] 可视化增强（多周期对比、回撤热力图）
- [ ] 基础权限层级（只读 / 回测 / 代码修改）

### 🔜 Phase 2b — 产品化安全 + 恢复（规划中）
- [ ] 完整权限系统（PreToolUse/PostToolUse hooks + allow/ask/deny）
- [ ] Context compaction + 缓存友好压缩（OpenClacky 策略）
- [ ] Stop hooks（策略质量自动校验）
- [ ] 实盘操作门禁

### 🔜 Phase 3 — 高级能力（远期）
- [ ] Skills 自进化（策略模板自动沉淀）
- [ ] Memory 持久化（CLAUDE.md 模式）
- [ ] 团队协作（session fork/clone）
- [ ] MCP 接入外部数据源

---

## Demo 演示用例

### 双均线策略端到端

1. 打开 Web UI，输入："帮我写一个双均线策略，用 A 股 600519 分钟数据回测"
2. Agent 自动执行：
   - `fetch_data` 通过 Tushare stk_mins API 拉取 600519 真实分钟数据
   - `DeepSeek` 根据数据和策略模板生成 rqalpha 策略代码
   - `backtest` 在 Docker sandbox 内执行回测（隔离执行，5s 硬超时）
   - `WebSocket` 实时推送每一步的进度事件
3. Web UI 展示回测结果：
   - 权益曲线（Canvas 渲染）
   - 策略指标：夏普比率、最大回撤、胜率、年化收益

---

## 启动指南

### 环境要求
- Node.js ≥18
- Docker（用于 sandbox 回测容器）
- npm 或 yarn

### 快速启动
```bash
# 1. 安装依赖
cd agent-core
npm install

# 2. 配置环境变量
export DEEPSEEK_API_KEY="sk-xxx"
export TUSHARE_TOKEN="xxx"

# 3. 运行测试
npm test -- --runInBand

# 4. 构建并启动
npm run build && npm start
```

### Docker 部署（50 用户）

D1/D2/P2A-1 当前交付物在仓库根目录：

| 文件 | 用途 |
|------|------|
| `Dockerfile` | 构建 agent-core 运行镜像，内置 PM2 runtime |
| `docker-compose.yml` | 编排 `agent` + `nginx`，挂载 `/var/run/docker.sock` 给 sandbox 回测容器 |
| `ecosystem.config.cjs` | PM2 cluster 配置，默认 `instances=max`，崩溃自动重启 |
| `nginx.conf` | nginx 反向代理，`/ws` 支持 WebSocket upgrade，`/healthz` 转发健康检查 |
| `scripts/ws-load-test.mjs` | 50 并发 WebSocket 在线/断连率压测入口 |
| `agent-core/src/sandbox/manager.ts` | 多用户 Docker sandbox manager，负责资源池、用户数据隔离、生命周期清理 |

#### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DEEPSEEK_API_KEY` | 是 | — | DeepSeek API Key，仅服务端注入 |
| `TUSHARE_TOKEN` | 是 | — | Tushare Token，仅服务端注入 |
| `HTTP_PORT` | 否 | `80` | nginx 对外端口 |
| `WEB_CONCURRENCY` | 否 | `max` | PM2 cluster 实例数 |
| `PM2_MAX_MEMORY_RESTART` | 否 | `512M` | 单进程内存重启阈值 |
| `AGENT_DATA_DIR` | 否 | `/data` | session / 数据持久化目录 |
| `RQALPHA_IMAGE` | 否 | `quant-agent-rqalpha:latest` | sandbox 回测镜像名 |
| `SANDBOX_MAX_CONCURRENT` | 否 | `8` | sandbox 资源池最大并发容器数 |
| `SANDBOX_MEMORY_MB` | 否 | `256` | 单 sandbox 容器内存限制 |
| `SANDBOX_CPUS` | 否 | `1` | 单 sandbox 容器 CPU 限制 |
| `SANDBOX_TIMEOUT_SECONDS` | 否 | `5` | 单 sandbox 运行超时 |

#### 本地构建与启动

```bash
# 在仓库根目录执行
export DEEPSEEK_API_KEY="sk-xxx"
export TUSHARE_TOKEN="xxx"
docker build -t quant-agent-rqalpha:latest agent-core/sandbox/rqalpha
docker compose up --build -d

# 健康检查：返回 200 + status + uptime_seconds
curl -fsS http://127.0.0.1:${HTTP_PORT:-80}/healthz
```

#### 日志与配置路径

| 项 | 路径 |
|----|------|
| PM2 配置 | `/app/ecosystem.config.cjs`（镜像内），仓库根目录 `ecosystem.config.cjs` |
| nginx 配置 | `/etc/nginx/conf.d/default.conf`（容器内），仓库根目录 `nginx.conf` |
| 应用 stdout | `/var/log/quant-agent/out.log`（`agent_logs` volume） |
| 应用 stderr | `/var/log/quant-agent/err.log`（`agent_logs` volume） |
| 持久化数据 | `/data`（`agent_data` volume） |

#### 50 并发压测

```bash
# 默认 50 并发、30s、断连率阈值 <1%
node scripts/ws-load-test.mjs ws://127.0.0.1:${HTTP_PORT:-80}/ws 50 30000
```

验收阈值：50 个 WebSocket 同时在线，断连率 `<1%`；进程崩溃后由 PM2/Compose 在 30s 内拉起，`/healthz` 恢复 200。

---

## 工具清单

| 工具 | 功能 | 权限 | 超时 |
|------|------|------|------|
| read | 读取文件（支持 offset/limit） | 只读 | — |
| write | 创建/重写文件 | 可修改 | — |
| edit | 精确文本替换（oldText/newText） | 可修改 | — |
| fetch_data | 拉取 Tushare A 股分钟数据 | 只读 | 60s |
| load_resource | 加载外部内容注入 context | 只读 | 60s |
| backtest | Docker sandbox 策略回测 | 隔离执行 | 5s |

### 安全约束
- 所有文件操作受 `safeResolve` 路径边界保护
- backtest 在独立 Docker 容器执行（256MB / 无网络 / 只读数据挂载）
- 用户不可指定回测数据挂载路径
- API Key / Token 仅通过环境变量注入，不进前端、日志、PR

---

## 验收标准

Demo 交付验收（6 条唯一标准）：

1. **端到端链路**：双均线策略从用户输入到回测结果展示全流程跑通，使用 Tushare 真实 A 股数据
2. **并发隔离**：50 并发 session 跑 5 分钟，session 数据互不穿透，错误率 <1%
3. **故障恢复**：kill 进程后 30s 内自动恢复，断连自动恢复成功率 ≥95%
4. **凭据安全**：DeepSeek Key / Tushare Token 不进前端代码、日志输出、PR 描述
5. **错误处理**：外部请求 60s 超时 + sandbox 5s 硬超时，超时返回明确错误提示
6. **响应延迟**：P95 交互延迟 <2s

> **注意**：24h 零断流、5s 内恢复等为上线前稳定性测试标准，不列入 Demo 验收。

---

## 参考来源

本项目设计参考了以下开源项目和分析：

- [Pi](https://github.com/nicholasgriffintn/pi) — 最小化 AI coding agent，提供 Agent loop、JSONL session tree、SDK/RPC 嵌入架构
- [Claude Code](https://github.com/anthropics/claude-code) — Anthropic 官方 coding agent，提供工业级权限系统、工具生命周期、context recovery
- [rqalpha](https://github.com/ricequant/rqalpha) — RiceQuant 开源回测引擎，事件驱动架构 + Mod 插件系统
- [Tushare](https://tushare.pro) — A 股量化数据源

---

## 贡献

- **dunature** — 项目发起人
- **技术负责人** — 架构设计、任务分配、代码合入
- **产品经理** — 需求定义、验收标准、产品决策
- **调研员** — 技术验证、数据链路确认、rqalpha 适配
- **工程师** — 核心开发、工具实现、Web UI
- **代码评审** — PR 评审、安全检查、diff 核对
- **测试** — QA 验收、端到端测试、压测

---

## API 参考

### WebSocket

WebSocket 通过 `/ws` 建立；为兼容旧 Demo，根路径 Upgrade 仍接受，但部署与前端统一使用 `/ws`。

**入站帧（client→server）**

```json
{"type": "message", "text": "写一个双均线策略，用 600519 分钟数据"}
{"type": "tree", "sessionId": "s1", "leafId": "abc123"}
{"type": "fork", "sessionId": "s1", "entryId": "abc123"}
{"type": "clone", "sessionId": "s1"}
```

**出站事件（server→client）**

```json
{"type": "turn_start", "sessionId": "s1"}
{"type": "message_delta", "content": "好的，我来..."}
{"type": "tool_execution_start", "tool": "fetch_data", "params": {"ts_code": "600519.SH"}}
{"type": "tool_execution_update", "tool": "fetch_data", "status": "1446 rows"}
{"type": "tool_execution_end", "tool": "fetch_data", "result": "success"}
{"type": "backtest_result", "equity_curve": [...], "sharpe": 1.2, "max_drawdown": 0.15}
{"type": "turn_end", "tokens": 12345}
```

### Health Check

| 端点 | 说明 |
|------|------|
| `GET /healthz` | 返回 `200` + `status` + `uptime_seconds` + `active_ws_clients` + `attached_sessions` |
