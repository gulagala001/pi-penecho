// persona 系统:personas/*.md(frontmatter + 正文),画布契约/变量注入,workspace 的 CLAUDE.md 热加载
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "personas");
const USER_DIR = path.join(os.homedir(), ".pi-penecho", "personas");

// --- 极简 frontmatter 解析(--- 之间的 key: value) ---
function parsePersona(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return {
    id: path.basename(filePath, ".md"),
    name: meta.name || path.basename(filePath, ".md"),
    description: meta.description || "",
    workspace: meta.workspace ? meta.workspace.replace(/^~/, os.homedir()) : null,
    body: m[2].trim(),
  };
}

export function listPersonas() {
  const found = new Map();
  for (const dir of [BUILTIN_DIR, USER_DIR]) {
    try {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const p = parsePersona(path.join(dir, f));
        if (p && !found.has(p.id)) found.set(p.id, p);
      }
    } catch {}
  }
  return [...found.values()];
}

export function getPersona(id) {
  return listPersonas().find((p) => p.id === id) || listPersonas()[0] || null;
}

// workspace 的 CLAUDE.md(职责文件)热加载
const claudeMdCache = new Map(); // file -> { mtimeMs, text }
function loadWorkspaceClaudeMd(workspace) {
  const file = path.join(workspace, "CLAUDE.md");
  try {
    const st = fs.statSync(file);
    const hit = claudeMdCache.get(file);
    if (!hit || hit.mtimeMs !== st.mtimeMs) {
      const text = fs.readFileSync(file, "utf8");
      claudeMdCache.set(file, { mtimeMs: st.mtimeMs, text });
      console.log(`[prompt] ${file} 已加载/更新 (${text.length} 字符)`);
    }
    return claudeMdCache.get(file).text;
  } catch { return null; }
}

// 装配最终系统提示:persona 正文(变量替换)+ workspace CLAUDE.md(若有)+ 画布契约
export function buildSystemPrompt(persona, canvasContract, prefs = {}) {
  let body = persona.body;
  const vars = {
    boardFontSize: prefs.boardFontSize ? String(prefs.boardFontSize) : "66",
    canvasContract: canvasContract || "",
    workspace: persona.workspace || "",
  };
  for (const [k, v] of Object.entries(vars)) body = body.split(`{{${k}}}`).join(v);

  const parts = [body];
  if (persona.workspace) {
    const claudeMd = loadWorkspaceClaudeMd(persona.workspace);
    if (claudeMd) parts.push(`\n\n【工作区职责文件 CLAUDE.md 全文】\n${claudeMd}`);
  }
  // 契约兜底:persona 没写 {{canvasContract}} 占位就自动附在最后
  if (canvasContract && !persona.body.includes("{{canvasContract}}")) {
    parts.push(`\n\n【画布输出契约(最高优先级,只输出此 JSON)】\n${canvasContract}`);
  }
  return parts.join("\n");
}
