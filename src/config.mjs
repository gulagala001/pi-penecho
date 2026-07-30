// 配置中心:v2 schema(多端点 profiles + persona + 通用项),热更新,旧版自动迁移
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".pi-penecho");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LEGACY_FILE = path.join(os.homedir(), ".penecho", "tutor-bridge.json");

// API 格式:anthropic=Anthropic Messages 兼容(Kimi/中转);openai=OpenAI chat/completions 兼容;openai-responses=OpenAI Responses(官方)
export const API_FORMATS = ["anthropic", "openai", "openai-responses"];

export const CONFIG_DEFAULTS = {
  version: 2,
  activeProfile: "default",
  profiles: {
    default: {
      apiFormat: "anthropic",
      apiUrl: "https://api.kimi.com/coding",
      apiKey: "",
      model: "k3",
      contextWindow: null, // null = 自动(catalog 值 / 端点拉取值)
      maxTokens: null,
    },
  },
  persona: "general",
  thinkingLevel: "medium",
  keepImages: 8,
  boardFontSize: 66,
};

function deepMerge(base, patch) {
  const out = { ...base, ...patch };
  out.profiles = { ...base.profiles };
  for (const [name, p] of Object.entries(patch.profiles || {})) {
    out.profiles[name] = { ...base.profiles.default, ...p };
  }
  return out;
}

// 旧版(~/.penecho/tutor-bridge.json, 单端点)→ v2
function migrateLegacy() {
  try {
    if (fs.existsSync(CONFIG_FILE) || !fs.existsSync(LEGACY_FILE)) return;
    const old = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
    const cfg = structuredClone(CONFIG_DEFAULTS);
    cfg.profiles.default = {
      apiFormat: "anthropic",
      apiUrl: old.apiUrl || CONFIG_DEFAULTS.profiles.default.apiUrl,
      apiKey: old.apiKey || "",
      model: old.model || "k3",
      contextWindow: old.contextWindow ?? null,
      maxTokens: old.maxTokens ?? null,
    };
    if (old.thinkingLevel) cfg.thinkingLevel = old.thinkingLevel;
    if (old.keepImages !== undefined) cfg.keepImages = old.keepImages;
    if (old.boardFontSize !== undefined) cfg.boardFontSize = old.boardFontSize;
    cfg.persona = "kaoyan-tutor"; // 旧版就是考研家教
    saveConfig(cfg);
    console.log("[config] 已从旧版 ~/.penecho/tutor-bridge.json 迁移到 v2");
  } catch (err) { console.error("[config] 旧版迁移失败:", err.message); }
}

export function loadConfig() {
  migrateLegacy();
  let cfg = structuredClone(CONFIG_DEFAULTS);
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = deepMerge(cfg, JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
    } else {
      saveConfig(cfg);
    }
  } catch (err) { console.error("[config] 读取失败,用默认值:", err.message); }
  if (!cfg.profiles[cfg.activeProfile]) cfg.activeProfile = Object.keys(cfg.profiles)[0] || "default";
  // 环境变量兜底 key(首次/未配置时)
  const envKey = process.env.KIMI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  if (envKey && !cfg.profiles[cfg.activeProfile].apiKey) cfg.profiles[cfg.activeProfile].apiKey = envKey;
  return cfg;
}

export function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch {}
}

export function activeProfile(cfg) {
  return cfg.profiles[cfg.activeProfile] || cfg.profiles.default;
}

export function maskedKey(profile) {
  const k = profile?.apiKey || "";
  return k ? k.slice(0, 6) + "***" + k.slice(-4) : null;
}
