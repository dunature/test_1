import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AgentEventHub,
  AgentSession,
  AuthStorage,
  createBacktestTool,
  createBridgeServer,
  createDefaultResourceOperations,
  createDockerRqalphaOperations,
  createEditTool,
  createFetchDataTool,
  createLoadResourceTool,
  createNodeFileOperations,
  createReadTool,
  createSessionApi,
  createTushareOperations,
  createWriteTool,
  ModelRegistry,
  OpenAICompatibleAdapter,
  ToolRegistry,
} from "./index.js";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "0.0.0.0";
const agentDataDir = resolve(process.env.AGENT_DATA_DIR ?? join(process.cwd(), ".agent"));
const workspaceRoot = resolve(process.env.AGENT_WORKSPACE_ROOT ?? join(agentDataDir, "workspace"));
const dataRoot = resolve(process.env.AGENT_DATA_ROOT ?? join(agentDataDir, "market"));
const sessionDir = resolve(process.env.AGENT_SESSION_DIR ?? join(agentDataDir, "sessions"));
const staticDir = resolve(process.env.AGENT_STATIC_DIR ?? process.env.STATIC_DIR ?? join(process.cwd(), "public"));

mkdirSync(workspaceRoot, { recursive: true });
mkdirSync(dataRoot, { recursive: true });
mkdirSync(sessionDir, { recursive: true });

const hub = new AgentEventHub();

const server = createBridgeServer(hub, {
  staticDir,
  sessionDir,
  sessionApi: createSessionApi(sessionDir),
  startedAt: Date.now(),
  sessionFactory: (client) => createRuntimeSession(createTools(client.sessionId), client.sessionId),
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ level: "info", msg: "quant-agent listening", host, port, workspaceRoot, dataRoot, sessionDir }));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

function createTools(userId: string): ToolRegistry {
  const registry = new ToolRegistry();
  const files = createNodeFileOperations(workspaceRoot);
  registry.register(createReadTool(files));
  registry.register(createWriteTool(files));
  registry.register(createEditTool(files));
  registry.register(createFetchDataTool(createTushareOperations()));
  registry.register(createLoadResourceTool(createDefaultResourceOperations(workspaceRoot)));
  const backtestOptions: { image: string; dataRoot: string; dataPath?: string } = {
    image: process.env.RQALPHA_IMAGE ?? "quant-agent-rqalpha:latest",
    dataRoot,
  };
  if (process.env.RQALPHA_DATA_PATH) backtestOptions.dataPath = process.env.RQALPHA_DATA_PATH;
  registry.register(createBacktestTool(createDockerRqalphaOperations(backtestOptions), { userId }));
  return registry;
}

function createRuntimeSession(tools: ToolRegistry, sessionId: string): AgentSession {
  const auth = AuthStorage.inMemory();
  const modelId = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const models = ModelRegistry.inMemory(auth, {
    providers: {
      deepseek: {
        name: "DeepSeek",
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
        models: [{ id: modelId, name: "DeepSeek", supportsTools: true }],
      },
    },
  });
  const model = models.find("deepseek", modelId);
  if (!model) throw new Error("DeepSeek model configuration is missing");
  const requestAuth: { apiKey?: string } = {};
  if (process.env.DEEPSEEK_API_KEY) requestAuth.apiKey = process.env.DEEPSEEK_API_KEY;
  return new AgentSession({
    provider: new OpenAICompatibleAdapter("deepseek"),
    model,
    auth: requestAuth,
    tools,
    sessionId,
    systemPrompt: "You are Quant Agent, a cautious quantitative strategy assistant. Use tools for data, code, and sandboxed backtests; never expose credentials.",
  });
}
