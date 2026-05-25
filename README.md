# Quant Agent — 网页端量化策略开发智能体

## 项目概述

Quant Agent 是一个在网页端运行的 AI 智能体，专为量化策略研究员设计。它能够接收用户的自然语言策略需求，自动完成：数据拉取 → 策略代码生成 → 沙箱回测执行 → 结果可视化展示的完整闭环。

**核心价值**：让研究员用一句话描述策略思路，Agent 自动完成从数据到回测结果的全流程，并在 Web 界面实时展示每一步的进度和结果。

**目标用户**：专业量化研究员，熟悉 Python 和量化策略开发流程。

**当前状态**：Phase 1 + Demo 增强已完成，支持双均线策略端到端演示。Phase 2（完整回测引擎 + 权限系统 + 压缩恢复）规划中。

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
- [x] PR #1 和 PR #2 通过代码评审和 QA 验收（26/26 测试全绿）

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

# 4. 启动开发服务器
npm run dev
```

### Docker 部署（50 用户）

#### 构建

```bash
# 构建 agent-core 镜像
cd agent-core
docker build -t quant-agent .

# 构建 sandbox 回测镜像
cd sandbox/rqalpha
docker build -t quant-agent-sandbox .
```

#### PM2 集群配置（ecosystem.config.js）

```js
module.exports = {
  apps: [{
    name: 'quant-agent',
    script: 'dist/index.js',
    instances: 'max',        // CPU 核数
    exec_mode: 'cluster',
    env: {
      PORT: 3000,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      TUSHARE_TOKEN: process.env.TUSHARE_TOKEN,
    },
    max_memory_restart: '512M',
    error_file: '/var/log/quant-agent/err.log',
    out_file: '/var/log/quant-agent/out.log',
    kill_timeout: 5000,
  }]
};
```

#### nginx 反向代理（nginx.conf）

```nginx
upstream quant_agent {
    ip_hash;  # WebSocket 会话保持
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name agent.example.com;

    # WebSocket 升级
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_http_version 1.1;
    proxy_read_timeout 65s;  # 略大于外部链路 60s 超时

    location / {
        proxy_pass http://quant_agent;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 静态文件直接服务
    location /public/ {
        alias /app/public/;
    }
}
```

#### docker-compose.yml

```yaml
version: '3.8'
services:
  agent:
    build: ./agent-core
    environment:
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - TUSHARE_TOKEN=${TUSHARE_TOKEN}
    volumes:
      - agent_data:/data
      - /var/run/docker.sock:/var/run/docker.sock  # sandbox 容器管理
    restart: always

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - agent
    restart: always

volumes:
  agent_data:
```

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

Demo 交付验收需满足以下 5 条：

1. **端到端链路**：双均线策略从用户输入到回测结果展示全流程跑通，使用 Tushare 真实 A 股数据
2. **并发隔离**：50 用户同时使用，session 数据互不穿透，WebSocket 不断流
3. **故障恢复**：进程崩溃后 PM2 自动重启，session 状态可恢复
4. **凭据安全**：DeepSeek Key / Tushare Token 不进前端代码、日志输出、PR 描述
5. **错误处理**：外部请求 60s 超时 + sandbox 5s 硬超时，超时返回明确错误提示

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

### WebSocket 端点

| 端点 | 方向 | 说明 |
|------|------|------|
| `ws://host/ws` | client→server | 用户消息、/tree、/fork、/clone 命令 |
| `ws://host/ws` | server→client | agent_start/end, turn_start/end, message_delta, tool_execution_start/update/end |

### WebSocket 入站帧（client→server）

```json
{"type": "message", "text": "写一个双均线策略，用 600519 分钟数据"}
{"type": "tree", "action": "jump", "entryId": "abc123"}
{"type": "fork"}
{"type": "clone"}
```

### WebSocket 出站事件（server→client）

```json
{"type": "turn_start", "sessionId": "s1"}
{"type": "message_delta", "content": "好的，我来..."}
{"type": "tool_execution_start", "tool": "fetch_data", "params": {"ts_code": "600519.SH"}}
{"type": "tool_execution_update", "tool": "fetch_data", "status": "1446 rows"}
{"type": "tool_execution_end", "tool": "fetch_data", "result": "success"}
{"type": "backtest_result", "equity_curve": [...], "sharpe": 1.2, "max_drawdown": 0.15}
{"type": "turn_end", "tokens": 12345}
```

### Session API（HTTP）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/session` | 创建新 session |
| GET | `/api/session/:id` | 获取 session 信息 |
| POST | `/api/session/:id/tree` | 移动 leaf 到指定 entry |
| POST | `/api/session/:id/fork` | 从当前 session fork |
| POST | `/api/session/:id/clone` | 克隆当前 active branch |
