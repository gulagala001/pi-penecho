// 项目内多会话:JsonlSessionRepo 薄层(复用 pi-agent-core,不重复造轮子——见 plan 偏离记录)
// 语义:每会话一个 jsonl 存档(CONFIG_DIR/sessions/),当前指针落盘 sessions-current.json;
// 切换=当前增量入档→回放目标;persona 记入会话元数据,随切换生效(exit_criteria ②)。
// 已知限制:①undoTurn 后 jsonl 残留被撤销条目(回放可见,危害小,不特殊处理)
//          ②存档图像占位化(文字与板书才是跨会话记忆;base64 入档体积不可控)
//          ③双端同步同一存档时避免同时聊同一会话(syncthing 冲突会产 conflict 副本,不丢但分叉)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { CONFIG_DIR } from "./config.mjs";

const SESSIONS_ROOT = path.join(CONFIG_DIR, "sessions");
const CURRENT_FILE = path.join(CONFIG_DIR, "sessions-current.json");

let repo = null;
let bridge = null; // { getAgent, getRuntime, applyRuntime, saveConfig, replaceMessages, hardReset }
let currentId = null;
let recordedCount = 0; // agent.state.messages 中已入档条数(增量 append)

export function initSessions(bridgeFns) {
  bridge = bridgeFns;
  const env = new NodeExecutionEnv({ cwd: os.homedir() });
  repo = new JsonlSessionRepo({ fs: env, sessionsRoot: SESSIONS_ROOT });
  try { currentId = JSON.parse(fs.readFileSync(CURRENT_FILE, "utf8")).id || null; } catch { currentId = null; }
}

function saveCurrent() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CURRENT_FILE, JSON.stringify({ id: currentId }));
}

// 图像占位化:存档不进 base64
function toArchivable(m) {
  if (m?.role === "user" && Array.isArray(m.content) && m.content.some((c) => c?.type === "image")) {
    return { ...m, content: m.content.map((c) => (c?.type === "image" ? { type: "text", text: "[白板图像]" } : c)) };
  }
  return m;
}

async function findMeta(id) {
  const list = await repo.list({ cwd: os.homedir() });
  return list.find((m) => m.id === id) || null;
}

/** 当前会话新增消息增量入档(bridge 轮次钩子调用) */
export async function appendDelta() {
  if (!currentId || !bridge) return;
  const meta = await findMeta(currentId);
  if (!meta) return;
  const msgs = bridge.getAgent().state.messages;
  if (msgs.length <= recordedCount) { recordedCount = msgs.length; return; } // undo 后自动对齐
  const session = await repo.open(meta);
  for (const m of msgs.slice(recordedCount)) await session.appendMessage(toArchivable(m));
  recordedCount = msgs.length;
}

export async function listSessions() {
  const list = await repo.list({ cwd: os.homedir() });
  const out = [];
  for (const m of list) {
    let name = m.metadata?.name;
    if (!name) { try { name = await (await repo.open(m)).getSessionName(); } catch { /* 忽略坏档 */ } }
    out.push({ id: m.id, name: name || "未命名会话", persona: m.metadata?.persona || null, createdAt: m.createdAt });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { current: currentId, sessions: out };
}

export async function createSession(name) {
  await appendDelta().catch(() => {}); // 旧会话尾巴先入档
  const rt = bridge.getRuntime();
  const session = await repo.create({ cwd: os.homedir(), metadata: { persona: rt.cfg.persona } });
  const meta = await session.getMetadata();
  const display = (name || "").trim()
    || `会话 ${new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  await session.appendSessionName(display);
  await bridge.hardReset();
  currentId = meta.id; recordedCount = 0;
  saveCurrent();
  console.log(`[sessions] 新建并切换: ${display} (${meta.id.slice(0, 8)})`);
  return { id: meta.id, name: display };
}

export async function switchSession(id) {
  if (id === currentId) return { id, already: true };
  const meta = await findMeta(id);
  if (!meta) throw new Error("会话不存在: " + id);
  await appendDelta().catch((e) => console.log("[sessions] 存档当前失败(继续切换):", e.message));
  const session = await repo.open(meta);
  const ctx = await session.buildContext();
  await bridge.replaceMessages(ctx.messages);
  currentId = id; recordedCount = ctx.messages.length;
  saveCurrent();
  // persona 随会话
  const wantPersona = meta.metadata?.persona;
  const rt = bridge.getRuntime();
  if (wantPersona && wantPersona !== rt.cfg.persona) {
    rt.cfg.persona = wantPersona;
    bridge.saveConfig(rt.cfg);
    bridge.applyRuntime(rt.cfg);
    console.log(`[sessions] persona 随会话切换为 ${wantPersona}`);
  }
  const name = (await session.getSessionName()) || id.slice(0, 8);
  console.log(`[sessions] 切换到 ${name}:回放 ${ctx.messages.length} 条`);
  return { id, name, messages: ctx.messages.length };
}

export async function renameSession(id, name) {
  const meta = await findMeta(id);
  if (!meta) throw new Error("会话不存在");
  const display = String(name || "").trim() || "未命名会话";
  await (await repo.open(meta)).appendSessionName(display);
  return { id, name: display };
}

export async function deleteSession(id) {
  const meta = await findMeta(id);
  if (!meta) return { removed: false };
  await repo.delete(meta);
  if (id === currentId) { currentId = null; recordedCount = 0; saveCurrent(); }
  return { removed: true };
}

/** 启动恢复:有当前指针则回放;无则建默认档(首轮请求前由 server await) */
export async function restoreCurrent() {
  if (currentId) {
    const meta = await findMeta(currentId);
    if (meta) {
      const ctx = await (await repo.open(meta)).buildContext();
      const agent = bridge.getAgent();
      agent.reset(); // 刚 init,无在跑轮次,无需 abort
      agent.state.messages = ctx.messages;
      recordedCount = ctx.messages.length;
      console.log(`[sessions] 启动回放 ${ctx.messages.length} 条 (${currentId.slice(0, 8)})`);
      return { restored: true, messages: ctx.messages.length };
    }
    currentId = null; saveCurrent(); // 指针悬空(档被外部删了)
  }
  const { id } = await createSession("默认会话");
  return { restored: false, id };
}
