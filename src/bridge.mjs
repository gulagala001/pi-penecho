// 桥核心:常驻 pi agent 单例、模型解析、白板轮次处理、会话管理
import crypto from "node:crypto";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, Type } from "@earendil-works/pi-ai";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { createWorkspaceTools } from "./tools.mjs";
import { buildSystemPrompt, getPersona } from "./prompt.mjs";
import { activeProfile } from "./config.mjs";

export const models = createModels();
models.setProvider(kimiCodingProvider());

// 结构化输出通道:模型通过 submit_board 工具提交契约 JSON(官方端点实测稳);
// 不支持的中转/弱模型会退化回文本 JSON,由 extractJson 兜底(双保险)
let capturedBoard = null;
const SUBMIT_BOARD_TOOL = {
  name: "submit_board",
  label: "提交板书回应",
  description: "提交你对白板的结构化回应。优先用此工具提交(参数即画布契约 JSON);只有工具调用不可用时才在正文输出纯 JSON。",
  parameters: Type.Object({
    intent: Type.Union(["none", "hint", "continue", "explain", "plot", "correct", "erase", "answer", "typeset"].map((x) => Type.Literal(x))),
    observedText: Type.Optional(Type.String({ description: "对学生最新笔迹的转写" })),
    message: Type.Optional(Type.String()),
    commands: Type.Array(Type.Object({}, { additionalProperties: true })),
  }),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  execute: async (id, params) => {
    capturedBoard = params;
    return { content: [{ type: "text", text: "已提交" }] };
  },
};

let agent = null;
let runtime = { cfg: null, persona: null };
export const turnLog = []; // 最近轮次摘要(控制台用)

// ---------- 模型解析:catalog → 端点拉取数据 → k3 模板兜底(压 maxTokens) ----------

export function resolveModel(profile, fetchedModels = []) {
  const fromCatalog = models.getModel("kimi-coding", profile.model);
  if (fromCatalog) {
    const m = { ...fromCatalog, baseUrl: profile.apiUrl };
    if (profile.contextWindow) m.contextWindow = profile.contextWindow;
    if (profile.maxTokens) m.maxTokens = profile.maxTokens;
    return m;
  }
  const template = models.getModel("kimi-coding", "k3");
  if (!template) return null;
  const hit = fetchedModels.find((m) => m.id === profile.model);
  const ctx = profile.contextWindow || hit?.context || 262144;
  const maxT = profile.maxTokens || Math.min(32768, ctx);
  console.log(`[config] 模型 ${profile.model} 不在内置目录,按 k3 模板构造(ctx=${ctx}, maxTokens=${maxT})`);
  return { ...template, id: profile.model, name: profile.model, baseUrl: profile.apiUrl, contextWindow: ctx, maxTokens: maxT };
}

// ---------- 图像剪枝 ----------

async function pruneOldImages(messages) {
  const KEEP = runtime.cfg?.keepImages ?? 8;
  const imgIdx = messages
    .map((m, i) => (m?.role === "user" && Array.isArray(m.content) && m.content.some((c) => c?.type === "image") ? i : -1))
    .filter((i) => i >= 0);
  if (imgIdx.length <= KEEP) return messages;
  const keep = new Set(imgIdx.slice(-KEEP));
  return messages.map((m, i) =>
    imgIdx.includes(i) && !keep.has(i)
      ? { ...m, content: m.content.map((c) => (c?.type === "image" ? { type: "text", text: "[历史白板图像已省略]" } : c)) }
      : m
  );
}

// ---------- agent 生命周期 ----------

export function initAgent(cfg) {
  runtime.cfg = cfg;
  runtime.persona = getPersona(cfg.persona);
  const profile = activeProfile(cfg);
  const model = resolveModel(profile, runtime.fetchedModels);
  if (!model) throw new Error("模型目录初始化失败");
  agent = new Agent({
    initialState: {
      systemPrompt: "(pending)",
      model,
      tools: [...createWorkspaceTools(runtime.persona?.workspace), SUBMIT_BOARD_TOOL],
      thinkingLevel: cfg.thinkingLevel,
    },
    streamFn: models.streamSimple.bind(models),
    getApiKey: () => activeProfile(runtime.cfg).apiKey || process.env.KIMI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "",
    transformContext: pruneOldImages,
    afterToolCall: (context) => {
      // 输出工具调用后立即停轮(板书已捕获,无需继续生成)
      const name = context.toolCall?.name || "";
      if (name === "submit_board") return { terminate: true };
      return undefined;
    },
  });
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      runToolCalls.add(event.toolName || event.toolCall?.name || "");
      console.log(`[tool] ${event.toolName || event.toolCall?.name}`);
    }
  });
  return agent;
}

// 配置/persona 变更后应用(不重建 agent,保住会话)
export function applyRuntime(cfg, fetchedModels) {
  const personaChanged = cfg.persona !== runtime.cfg?.persona;
  runtime.cfg = cfg;
  if (fetchedModels) runtime.fetchedModels = fetchedModels;
  agent.state.model = resolveModel(activeProfile(cfg), runtime.fetchedModels || []);
  agent.state.thinkingLevel = cfg.thinkingLevel;
  if (personaChanged) {
    runtime.persona = getPersona(cfg.persona);
    agent.state.tools = [...createWorkspaceTools(runtime.persona?.workspace), SUBMIT_BOARD_TOOL];
    console.log(`[config] persona 切换为 ${runtime.persona?.id}(工具 ${agent.state.tools.length} 个)`);
  }
}

export function getAgent() { return agent; }
export function getRuntime() { return runtime; }

// ---------- 会话管理 ----------

let gen = 0;
export const currentGen = () => gen;

/** 硬复位:代际++ + 中止 + 等静默 + 清空 messages(多会话切换/回放的基础操作) */
export async function hardReset() {
  gen++; agent.abort();
  await agent.waitForIdle().catch(() => {});
  agent.reset();
}

/** 整体替换会话消息(回放存档用);调用前自动 hardReset */
export async function replaceMessages(msgs) {
  await hardReset();
  agent.state.messages = msgs;
}

// 轮次成功提交后的钩子(sessions.mjs 挂载,把本轮增量入档)
let onTurnCommitted = null;
export function setTurnCommittedHook(fn) { onTurnCommitted = fn; }

export async function resetSession() {
  await hardReset();
  turnLog.length = 0;
  console.log("[session] 新建对话:会话已清空");
}

export async function undoTurn() {
  gen++; agent.abort();
  await agent.waitForIdle().catch(() => {});
  const msgs = agent.state.messages;
  let cut = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "user" && Array.isArray(m.content) && m.content.some((c) => c?.type === "image")) { cut = i; break; }
  }
  if (cut >= 0) { agent.state.messages = msgs.slice(0, cut); turnLog.pop(); }
  console.log(`[session] 撤销上一轮: removed=${cut >= 0}, 剩 ${agent.state.messages.length} 条`);
  return cut >= 0;
}

// ---------- 工具函数 ----------

function lastAssistantText() {
  for (let i = agent.state.messages.length - 1; i >= 0; i--) {
    const m = agent.state.messages[i];
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      return m.content.filter((c) => c?.type === "text").map((c) => c.text || "").join("\n");
    }
  }
  return "";
}

function extractJson(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const LATEX_RE = /\$\$|\\frac|\\sum|\\int|\\lim|\\sqrt|\\begin\{/;

function anthropicResponse(jsonText) {
  return {
    id: "msg_" + crypto.randomUUID(), type: "message", role: "assistant", model: "bridge",
    content: [{ type: "text", text: jsonText }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

// ---------- 核心:处理一次白板请求 ----------

let runToolCalls = new Set();
export const canvasSystemRef = { value: "" }; // PenEcho 发来的画布契约缓存
export const fetchedModelsRef = { value: [] }; // 端点拉到的模型列表

export async function runTutorTurn(text, images, res) {
  const myGen = ++gen;
  agent.abort();
  await agent.waitForIdle().catch(() => {});
  if (myGen !== gen || res.writableEnded) return;

  runToolCalls = new Set();
  capturedBoard = null;
  agent.state.systemPrompt = buildSystemPrompt(runtime.persona, canvasSystemRef.value, { boardFontSize: runtime.cfg.boardFontSize }) +
    "\n\n输出方式:优先调用 submit_board 工具提交你的回应(参数即契约 JSON);仅当工具调用不可用时,才在正文中只输出契约 JSON 文本。";

  await agent.prompt(text, images);
  // 看门狗:正常轮(含工具链)应在几分钟内;480s 未完成视为卡死,abort 并 504
  const done = await Promise.race([
    agent.waitForIdle().then(() => true, () => true),
    new Promise((r) => setTimeout(() => r(false), 480_000)),
  ]);
  if (!done) {
    console.error("[tutor] 本轮 480s 未完成,判定卡死,abort");
    agent.abort();
    if (!res.writableEnded) {
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "timeout", message: "pi-penecho: agent turn exceeded 480s, aborted; please retry" } }));
    }
    return;
  }
  if (myGen !== gen || res.writableEnded) return;

  let parsed = (capturedBoard && capturedBoard.intent) ? capturedBoard : extractJson(lastAssistantText());
  if (!parsed) {
    console.log("[tutor] 输出非 JSON,要求重试。原文前300:", JSON.stringify(lastAssistantText().slice(0, 300)));
    console.log("[tutor][debug] lastMsg:", JSON.stringify(agent.state.messages[agent.state.messages.length - 1]).slice(0, 600));
    await agent.prompt("你的上一条输出不是有效 JSON。严格按画布输出契约,只输出 JSON 本身,前后不要任何其他文字。", []);
    await agent.waitForIdle();
    if (myGen !== gen || res.writableEnded) return;
    parsed = (capturedBoard && capturedBoard.intent) ? capturedBoard : extractJson(lastAssistantText());
  }
  if (!parsed) parsed = { intent: "none", commands: [] };
  if (!parsed.intent) parsed.intent = "none";
  if (!Array.isArray(parsed.commands)) parsed.commands = [];

  // 公式落档兜底:本轮板书含 LaTeX 公式但没写文件 → 让它补写(补写轮输出丢弃)
  if (runtime.persona?.workspace) {
    const jsonText = JSON.stringify(parsed);
    const formulaCmds = (parsed.commands || []).filter((c) => c?.tool === "draw_formula").length;
    const hasLatex = LATEX_RE.test(jsonText) || formulaCmds > 0;
    const wroteFile = [...runToolCalls].some((n) => n === "write_file" || n === "append_file");
    if (hasLatex && !wroteFile) {
      const count = (jsonText.match(LATEX_RE) || []).length + formulaCmds;
      if (count >= 3) {
        console.log("[tutor] 公式落档兜底:本轮无文件写入,要求补写黑板");
        try {
          await agent.prompt("提醒:你刚才的板书包含至少 3 处数学公式但没有落档。按铁律,现在用 append_file 把本段讲解(含全部公式的 LaTeX)补写到对应黑板 md;然后只回复 {\"intent\":\"none\",\"commands\":[]}。", []);
          await agent.waitForIdle();
        } catch (err) { console.error("[tutor] 落档补写失败:", err.message); }
      }
    }
  }
  if (myGen !== gen || res.writableEnded) return;

  console.log(`[tutor] intent=${parsed.intent} observed=${JSON.stringify(parsed.observedText || "").slice(0, 60)}`);
  turnLog.push({ t: Date.now(), intent: parsed.intent, observed: parsed.observedText || "", tools: [...runToolCalls].filter(Boolean) });
  if (turnLog.length > 100) turnLog.shift();
  if (onTurnCommitted) await onTurnCommitted().catch((e) => console.error("[sessions] 轮次入档失败:", e.message));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(anthropicResponse(JSON.stringify(parsed))));
}
