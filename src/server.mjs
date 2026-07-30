// pi-penecho — PenEcho ↔ pi agent 桥接服务(HTTP 路由层)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONFIG_FILE, loadConfig, saveConfig, activeProfile, maskedKey, API_FORMATS,
} from "./config.mjs";
import {
  initAgent, applyRuntime, getAgent, getRuntime, runTutorTurn, undoTurn,
  hardReset, replaceMessages, setTurnCommittedHook,
  turnLog, canvasSystemRef, fetchedModelsRef, openaiBaseUrl,
} from "./bridge.mjs";
import { listPersonas } from "./prompt.mjs";
import {
  pairStatus, pairTablet, createPairCode, redeemPairCode, confirmPair, rejectPair, pairMap,
  loadSyncFolders, saveSyncFolders, ensureSyncFolders, syncProgress,
} from "./pair.mjs";
import {
  initSessions, appendDelta, listSessions, createSession, switchSession,
  renameSession, deleteSession, restoreCurrent,
} from "./sessions.mjs";

const PORT = Number(process.env.PI_PENECHO_PORT || 9191);
// 资源路径允许 env 覆盖(Electron 打包后目录结构不同,由 desktop/main.mjs 注入)
const ADMIN_HTML = process.env.PI_PENECHO_ADMIN_HTML
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "admin.html");

// 日志统一带时间戳
const _log = console.log, _err = console.error;
console.log = (...a) => _log(new Date().toTimeString().slice(0, 8), ...a);
console.error = (...a) => _err(new Date().toTimeString().slice(0, 8), ...a);

// ---------- 配置 + 热更新 ----------

let cfg = loadConfig();
let configMtime = 0;
try { configMtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch {}

function hotReload() {
  try {
    const m = fs.statSync(CONFIG_FILE).mtimeMs;
    if (m !== configMtime) {
      configMtime = m;
      cfg = loadConfig();
      applyRuntime(cfg, fetchedModelsRef.value);
      console.log(`[config] 热加载: ${activeProfile(cfg).apiUrl} model=${activeProfile(cfg).model} thinking=${cfg.thinkingLevel} persona=${cfg.persona}`);
    }
  } catch {}
}

// 仅作为脚本主入口时拉起服务与副作用;被 import(测试/工具)时只暴露纯函数
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  initAgent(cfg);
  // 同步文件夹注册表落地(全新 syncthing 首次运行时建 folder;失败不阻断,配对确认时还会补)
  ensureSyncFolders().then((rs) => {
    const bad = rs.filter((r) => !r.ok);
    if (bad.length) console.log("[sync] 部分文件夹未落地:", bad.map((r) => `${r.id}(${r.error})`).join(", "));
  }).catch((e) => console.log("[sync] 启动落地失败(配对确认时会重试):", e.message));

  // 多会话:装配依赖 + 轮次入档钩子 + 启动回放(首个请求前 await sessionsReady)
  initSessions({ getAgent, getRuntime, applyRuntime, saveConfig, hardReset, replaceMessages });
  setTurnCommittedHook(appendDelta);
}
const sessionsReady = isMain
  ? restoreCurrent().catch((e) => { console.error("[sessions] 启动恢复失败:", e.message); })
  : Promise.resolve();

const upstreamEndpoint = () => activeProfile(cfg).apiUrl.replace(/\/+$/, "") + "/v1/messages";

// anthropic 请求体 → OpenAI 消息数组(system 提头,content 拍平为文本;无图请求才走这里)
function anthropicToOpenAIMessages(src) {
  const messages = [];
  if (typeof src.system === "string" && src.system) messages.push({ role: "system", content: src.system });
  for (const m of Array.isArray(src.messages) ? src.messages : []) {
    const text = Array.isArray(m.content)
      ? m.content.filter((b) => b?.type === "text").map((b) => b.text || "").join("\n")
      : String(m.content || "");
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  }
  return messages;
}

const anthropicShape = (id, model, text, usage = {}) => ({
  id: id || "msg_bridge", type: "message", role: "assistant", model,
  content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: usage.input || 0, output_tokens: usage.output || 0 },
});

// openai 系端点的无图透传:请求转成 chat/completions 或 responses,回包转回 anthropic 形状(配置测试才能真测通)
export async function openaiPassthrough(profile, src, res) {
  const base = openaiBaseUrl(profile.apiUrl);
  const key = profile.apiKey || process.env.OPENAI_API_KEY || "";
  const messages = anthropicToOpenAIMessages(src);
  const model = src.model || profile.model;
  const isResponses = (profile.apiFormat || "anthropic") === "openai-responses";
  const body = isResponses
    ? { model, input: messages }
    : { model, messages, max_tokens: src.max_tokens || 1024, stream: false };
  try {
    const up = await fetch(base + (isResponses ? "/responses" : "/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const raw = await up.text();
    if (!up.ok) { res.writeHead(up.status, { "Content-Type": "application/json" }); return res.end(raw); }
    const j = JSON.parse(raw);
    if (isResponses) {
      const text = (j.output || []).filter((o) => o?.type === "message")
        .flatMap((o) => o.content || []).filter((c) => c?.type === "output_text").map((c) => c.text || "").join("");
      return json(res, 200, anthropicShape(j.id, j.model || model, text, { input: j.usage?.input_tokens, output: j.usage?.output_tokens }));
    }
    const out = j.choices?.[0]?.message?.content ?? "";
    return json(res, 200, anthropicShape(j.id, j.model || model, typeof out === "string" ? out : JSON.stringify(out),
      { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens }));
  } catch (err) { return json(res, 502, { error: { message: String(err.message || err) } }); }
}

function publicConfig() {
  const p = activeProfile(cfg);
  const format = p.apiFormat || "anthropic";
  // 各格式占位模型列表(未从端点拉取时兜底)
  const fallbackModels = format === "anthropic"
    ? ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"]
    : format === "openai-responses"
      ? ["gpt-5", "gpt-5-mini", "o4-mini"]
      : ["gpt-4o", "gpt-4o-mini", "deepseek-chat", "deepseek-reasoner"];
  return {
    activeProfile: cfg.activeProfile,
    profileNames: Object.keys(cfg.profiles),
    apiFormat: format,
    apiFormats: API_FORMATS,
    apiUrl: p.apiUrl,
    apiKeyMasked: maskedKey(p),
    model: p.model,
    contextWindow: p.contextWindow,
    maxTokens: p.maxTokens,
    thinkingLevel: cfg.thinkingLevel,
    keepImages: cfg.keepImages,
    boardFontSize: cfg.boardFontSize,
    persona: cfg.persona,
    personas: listPersonas().map((x) => ({ id: x.id, name: x.name, description: x.description, workspace: x.workspace })),
    knownModels: fetchedModelsRef.value.length ? fetchedModelsRef.value : fallbackModels.map((id) => ({ id, name: id })),
    knownThinking: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const HOP = new Set(["host", "content-length", "connection", "transfer-encoding", "content-encoding"]);
const json = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

// ---------- 路由 ----------

const server = http.createServer(async (req, res) => {
  // 控制台
  if (req.method === "GET" && req.url === "/") {
    try { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(ADMIN_HTML, "utf8")); }
    catch { res.writeHead(404); return res.end("public/admin.html missing"); }
  }
  if (req.method === "GET" && req.url === "/vendor/qrcode.js") {
    try { res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(path.dirname(ADMIN_HTML), "vendor", "qrcode.js"), "utf8")); }
    catch { res.writeHead(404); return res.end("qrcode vendor missing"); }
  }
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, turns: getAgent().state.messages.length });
  // 控制台首屏二维码用:LAN IP + 门户端口(手机扫码到安装页下载 APK)
  if (req.method === "GET" && req.url === "/lan-info") {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((x) => x && x.family === "IPv4" && !x.internal).map((x) => x.address);
    return json(res, 200, { ok: true, ips, portalPort: INSTALL_PORT });
  }
  if (req.method === "GET" && req.url === "/config") return json(res, 200, publicConfig());

  if (req.method === "POST" && req.url === "/config/fetch-models") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    try {
      const profile = activeProfile(cfg);
      const format = String(body.apiFormat || profile.apiFormat || "anthropic");
      const url = String(body.apiUrl || profile.apiUrl).replace(/\/+$/, "");
      const key = body.apiKey || profile.apiKey;
      // anthropic 系用 x-api-key + /v1/models;openai 系用 Bearer + 归一化 base 后的 /models
      const headers = format === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${key}` };
      const modelsUrl = format === "anthropic" ? url + "/v1/models" : openaiBaseUrl(url) + "/models";
      const r = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`端点返回 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      fetchedModelsRef.value = (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id, context: m.context_length }));
      return json(res, 200, { ok: true, models: fetchedModelsRef.value });
    } catch (err) { return json(res, 400, { error: String(err.message || err) }); }
  }

  if (req.method === "POST" && req.url === "/config") {
    const patch = JSON.parse((await readBody(req)).toString("utf8"));
    try {
      const p = activeProfile(cfg);
      if (patch.apiFormat !== undefined) {
        const f = String(patch.apiFormat);
        if (!API_FORMATS.includes(f)) throw new Error("apiFormat 须为 " + API_FORMATS.join("/"));
        p.apiFormat = f;
      }
      if (patch.apiUrl !== undefined) {
        const u = String(patch.apiUrl).trim().replace(/\/+$/, "");
        if (!/^https?:\/\/[^/]+/.test(u)) throw new Error("apiUrl 格式不对");
        p.apiUrl = u;
      }
      if (patch.apiKey) p.apiKey = String(patch.apiKey); // 空=不变
      if (patch.model !== undefined) p.model = String(patch.model);
      if (patch.contextWindow !== undefined) p.contextWindow = Number(patch.contextWindow) || null;
      if (patch.maxTokens !== undefined) p.maxTokens = Number(patch.maxTokens) || null;
      if (patch.thinkingLevel !== undefined) cfg.thinkingLevel = String(patch.thinkingLevel);
      if (patch.keepImages !== undefined) cfg.keepImages = Math.max(0, Math.min(32, Number(patch.keepImages) || 0));
      if (patch.boardFontSize !== undefined) cfg.boardFontSize = Math.max(16, Math.min(200, Number(patch.boardFontSize) || 0)) || null;
      if (patch.persona !== undefined) cfg.persona = String(patch.persona);
      saveConfig(cfg);
      configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
      applyRuntime(cfg, fetchedModelsRef.value);
      console.log(`[config] 已更新: ${p.apiUrl} model=${p.model} thinking=${cfg.thinkingLevel} persona=${cfg.persona}`);
      return json(res, 200, { ok: true, ...publicConfig() });
    } catch (err) { return json(res, 400, { error: String(err.message || err) }); }
  }

  if (req.method === "POST" && req.url === "/profiles") {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    try {
      const { action, name } = body;
      if (!name || !/^[\w一-龥-]+$/.test(name)) throw new Error("profile 名称不合法");
      if (action === "save-as") {
        cfg.profiles[name] = { ...activeProfile(cfg) };
        cfg.activeProfile = name;
      } else if (action === "switch") {
        if (!cfg.profiles[name]) throw new Error("profile 不存在: " + name);
        cfg.activeProfile = name;
      } else if (action === "delete") {
        if (Object.keys(cfg.profiles).length <= 1) throw new Error("至少保留一个 profile");
        delete cfg.profiles[name];
        if (cfg.activeProfile === name) cfg.activeProfile = Object.keys(cfg.profiles)[0];
      } else throw new Error("未知 action: " + action);
      saveConfig(cfg);
      configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
      applyRuntime(cfg, fetchedModelsRef.value);
      console.log(`[profiles] ${action} → ${name},当前 ${cfg.activeProfile}`);
      return json(res, 200, { ok: true, ...publicConfig() });
    } catch (err) { return json(res, 400, { error: String(err.message || err) }); }
  }

  // ---- 多会话(存档在 ~/.pi-penecho/sessions,重启回放;reset=新建存档会话) ----
  if (req.method === "POST" && req.url === "/session/reset") {
    return json(res, 200, { ok: true, ...(await createSession()) });
  }
  if (req.method === "GET" && req.url === "/session/list") {
    try { return json(res, 200, { ok: true, ...(await listSessions()) }); }
    catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/session/new") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, { ok: true, ...(await createSession(body.name)) });
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/session/switch") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, { ok: true, ...(await switchSession(String(body.id || ""))) });
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/session/rename") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, { ok: true, ...(await renameSession(String(body.id || ""), body.name)) });
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/session/delete") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, { ok: true, ...(await deleteSession(String(body.id || ""))) });
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/session/undo") { return json(res, 200, { ok: true, removed: await undoTurn() }); }
  if (req.method === "GET" && req.url === "/session/turns") return json(res, 200, turnLog.slice(-50).reverse());

  // ---- 平板配对(Syncthing) ----
  if (req.method === "GET" && req.url === "/pair/status") {
    try { return json(res, 200, await pairStatus()); }
    catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/pair/tablet") {
    try { return json(res, 200, await pairTablet()); }
    catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  // 配对码:生成(电脑端)/ 核销(手机端)/ 确认(电脑端)/ 拒绝 / 映射(手机端)
  if (req.method === "POST" && req.url === "/pair/code") {
    return json(res, 200, { ok: true, ...createPairCode() });
  }
  if (req.method === "POST" && req.url === "/pair/redeem") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, await redeemPairCode(body.code, body.deviceId, body.deviceName));
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/pair/confirm") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, await confirmPair(body.deviceId, body.folders));
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "POST" && req.url === "/pair/reject") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, rejectPair(body.deviceId));
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  if (req.method === "GET" && req.url.startsWith("/pair/map")) {
    try {
      const q = new URL(req.url, "http://x").searchParams;
      return json(res, 200, await pairMap(q.get("deviceId")));
    } catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  // 同步进度(各文件夹对对端的完成度,进度条用)
  if (req.method === "GET" && req.url === "/sync/progress") {
    try { return json(res, 200, await syncProgress()); }
    catch (err) { return json(res, 200, { ok: false, error: String(err.message || err) }); }
  }
  // 同步文件夹注册表:保存(方向/启用修改)并落地到 syncthing
  if (req.method === "POST" && req.url === "/sync/folders") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!Array.isArray(body.folders)) throw new Error("folders 必须是数组");
      saveSyncFolders({ folders: body.folders });
      const results = await ensureSyncFolders();
      return json(res, 200, { ok: true, results, ...(await pairStatus()) });
    } catch (err) { return json(res, 400, { ok: false, error: String(err.message || err) }); }
  }

  if (req.method !== "POST" || req.url !== "/v1/messages") { res.writeHead(404); return res.end("not found"); }

  // ---- PenEcho 入口 ----
  await sessionsReady; // 首个请求前确保存档回放完成
  hotReload();
  const raw = await readBody(req);
  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch { res.writeHead(400); return res.end("bad json"); }

  const content = body?.messages?.[0]?.content;
  const hasImage = Array.isArray(content) && content.some((b) => b?.type === "image");
  console.log(`[req] hasImage=${hasImage} system=${typeof body.system === "string" ? body.system.length : typeof body.system} content=${Array.isArray(content) ? content.map((b) => b?.type).join("+") : typeof content}`);

  if (!hasImage) {
    // 无图请求(配置测试等):openai 系端点走格式转换透传;anthropic 系原样透传,均不进会话
    const profile = activeProfile(cfg);
    if ((profile.apiFormat || "anthropic") !== "anthropic") return openaiPassthrough(profile, body, res);
    try {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
      headers["x-api-key"] = profile.apiKey || headers["x-api-key"];
      const up = await fetch(upstreamEndpoint(), { method: "POST", headers, body: raw });
      const buf = Buffer.from(await up.arrayBuffer());
      const rh = {};
      up.headers.forEach((v, k) => { if (!HOP.has(k)) rh[k] = v; });
      res.writeHead(up.status, rh);
      return res.end(buf);
    } catch (err) { return json(res, 502, { error: { message: err.message } }); }
  }

  const hasSystem = typeof body.system === "string" && body.system.length > 100;
  if (hasSystem) canvasSystemRef.value = body.system;
  if (!hasSystem && !canvasSystemRef.value) {
    console.log("[req] 拒绝:带图请求无 system 且无缓存契约");
    return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "pi-penecho: canvas request arrived without system prompt; restart the bridge while PenEcho is running" } });
  }

  const text = content.filter((b) => b?.type === "text").map((b) => b.text || "").join("\n");
  const images = content
    .filter((b) => b?.type === "image" && b?.source?.data)
    .map((b) => ({ type: "image", data: b.source.data, mimeType: b.source.media_type || "image/png" }));

  req.on("close", () => { if (!res.writableEnded) getAgent().abort(); });
  try {
    await runTutorTurn(text, images, res);
    if (!res.writableEnded) { res.writeHead(499); res.end(); }
  } catch (err) {
    console.error("[tutor] 本轮失败:", err);
    if (!res.writableEnded) json(res, 500, { type: "error", error: { type: "api_error", message: String(err.message || err) } });
  }
});

if (isMain) server.listen(PORT, "0.0.0.0", () => {
  const p = activeProfile(cfg);
  console.log(`pi-penecho  http://127.0.0.1:${PORT}`);
  console.log(`profile=${cfg.activeProfile}  model=${p.model}  thinking=${cfg.thinkingLevel}  persona=${cfg.persona}  keepImages=${cfg.keepImages}`);
  // 绑 0.0.0.0:平板经 LAN 访问配对/同步 API(控制台与 PenEcho 本机回环不受影响)
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((x) => x && x.family === "IPv4" && !x.internal).map((x) => x.address);
  if (ips.length) console.log(`局域网入口(平板配对用): ${ips.map((ip) => `http://${ip}:${PORT}`).join("  ")}`);
});

// ---------- 局域网安装门户 ----------
// 独立端口、只读 dist/ 下的安装物料(APK/bundle/setup.sh/index.html),无任何 API;
// 平板与电脑同一 WiFi 时经此高速拉取全部文件,不依赖外网。dist/ 不存在(如平板端 bundle)则不启动。
const INSTALL_PORT = Number(process.env.PI_PENECHO_INSTALL_PORT || 9288);
const DIST_DIR = process.env.PI_PENECHO_DIST_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".apk": "application/vnd.android.package-archive",
  ".gz": "application/gzip",
  ".sh": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};
if (isMain && fs.existsSync(DIST_DIR)) {
  const portal = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/" || p === "") p = "/index.html";
      const file = path.normalize(path.join(DIST_DIR, p));
      if (!file.startsWith(DIST_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(500); res.end(); }
  });
  portal.on("error", (e) => console.log(`[portal] 安装门户启动失败(端口 ${INSTALL_PORT}): ${e.message}`));
  portal.listen(INSTALL_PORT, "0.0.0.0", () => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((x) => x && x.family === "IPv4" && !x.internal).map((x) => x.address);
    console.log(`安装门户(平板与电脑同一 WiFi 时访问): ${ips.map((ip) => `http://${ip}:${INSTALL_PORT}`).join("  ") || "(无局域网 IP)"}`);
  });
}
