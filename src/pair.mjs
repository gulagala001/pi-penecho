// 平板配对:配对码状态机(生成/核销/确认/拒绝)+ Syncthing 设备与文件夹管理
// 形态:电脑端生成 6 位码 → 手机输入 → 进入 pending → 电脑端确认(勾选文件夹+方向) → 同步建立
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// syncthing home 平台自适应:手机端(APK 内嵌)用 $HOME/sync,电脑端用 ~/.config/syncthing
const ST_HOME = fs.existsSync(path.join(os.homedir(), "sync", "config.xml"))
  ? path.join(os.homedir(), "sync")
  : path.join(os.homedir(), ".config", "syncthing");
const API = "http://127.0.0.1:8384/rest";
const CONFIG_DIR = path.join(os.homedir(), ".pi-penecho");
const SYNC_FOLDERS_FILE = path.join(CONFIG_DIR, "sync-folders.json");

// 默认注册表(首次自动生成;与 install-syncthing-mac.sh 注入的两项兼容)
const DEFAULT_FOLDERS = {
  folders: [
    { id: "kaoyan-new", label: "考研new", macPath: "~/Projects/考研new", tabletPath: "~/Projects/考研new", direction: "both", enabled: true },
    { id: "pi-penecho-config", label: "配置(含 key/人设)", macPath: "~/.pi-penecho", tabletPath: "~/.pi-penecho", direction: "both", enabled: true },
  ],
};

const DIRECTION_TO_TYPE = { both: "sendreceive", send: "sendonly", receive: "receiveonly" };
// 镜像:电脑端 type → 手机端 type
const MIRROR_TYPE = { sendreceive: "sendreceive", sendonly: "receiveonly", receiveonly: "sendonly" };

// ---------- 同步文件夹注册表 ----------

export function loadSyncFolders() {
  try {
    if (!fs.existsSync(SYNC_FOLDERS_FILE)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(SYNC_FOLDERS_FILE, JSON.stringify(DEFAULT_FOLDERS, null, 2));
      return structuredClone(DEFAULT_FOLDERS);
    }
    return JSON.parse(fs.readFileSync(SYNC_FOLDERS_FILE, "utf8"));
  } catch {
    return structuredClone(DEFAULT_FOLDERS);
  }
}

export function saveSyncFolders(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SYNC_FOLDERS_FILE, JSON.stringify(data, null, 2));
}

const expandHome = (p) => (p || "").replace(/^~/, os.homedir());

// ---------- Syncthing REST ----------

function readApiKey() {
  try {
    const xml = fs.readFileSync(path.join(ST_HOME, "config.xml"), "utf8");
    return xml.match(/<apikey>([^<]+)<\/apikey>/)?.[1] || null;
  } catch { return null; }
}

async function st(method, p, body) {
  const key = readApiKey();
  if (!key) throw new Error("Syncthing 未安装或未初始化 — 请先在电脑端运行 scripts/install-syncthing-mac.sh");
  const res = await fetch(API + p, {
    method,
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Syncthing API ${p} 返回 ${res.status}(服务在跑吗?)`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

const short = (id) => (id ? id.slice(0, 7) + "…" : "?");

/** 注册表 enabled 项在 syncthing 落地(创建/更新 folder;启动与保存时调用) */
export async function ensureSyncFolders() {
  const { folders } = loadSyncFolders();
  const results = [];
  for (const f of folders.filter((x) => x.enabled)) {
    const macPath = expandHome(f.macPath);
    if (!fs.existsSync(macPath)) { results.push({ id: f.id, ok: false, error: "本机路径不存在: " + macPath }); continue; }
    const type = DIRECTION_TO_TYPE[f.direction] || "sendreceive";
    let existing = null;
    try { existing = await st("GET", `/config/folders/${encodeURIComponent(f.id)}`); } catch { /* 不存在 */ }
    if (existing) {
      if (existing.type !== type || existing.paused) {
        existing.type = type; existing.paused = false;
        await st("PUT", `/config/folders/${encodeURIComponent(f.id)}`, existing);
      }
    } else {
      await st("POST", "/config/folders", {
        id: f.id, label: f.label || f.id, path: macPath, type,
        rescanIntervalS: 30, fsWatcherEnabled: true, fsWatcherDelayS: 5,
        ignorePerms: true, paused: false,
      });
    }
    results.push({ id: f.id, ok: true });
  }
  return results;
}

// ---------- 配对状态机 ----------

const pairing = {
  code: null,            // { value, expiresAt }
  pending: new Map(),    // deviceId -> { deviceId, name, requestedAt }
};

export function createPairCode() {
  const value = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  pairing.code = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
  return { code: value, expiresAt: pairing.code.expiresAt };
}

export async function redeemPairCode(code, deviceId, deviceName) {
  if (!deviceId || typeof deviceId !== "string" || deviceId.length < 20) {
    return { ok: false, error: "deviceId 不合法" };
  }
  const c = pairing.code;
  if (!c || Date.now() > c.expiresAt) return { ok: false, error: "配对码已过期,请在电脑端重新生成" };
  if (String(code || "").trim() !== c.value) return { ok: false, error: "配对码不对,请核对后重试" };
  pairing.code = null; // 一次性
  // 已配对设备短路:直接放行去同步文件夹设置(不入 pending,避免轮询把历史 peers 误判成本轮确认)
  try {
    const myId = (await st("GET", "/system/status")).myID;
    const devices = await st("GET", "/config/devices");
    if (devices.some((d) => d.deviceID === deviceId && d.deviceID !== myId)) {
      return { ok: true, alreadyPaired: true };
    }
  } catch { /* syncthing 未就绪则按未配对走正常流程 */ }
  pairing.pending.set(deviceId, { deviceId, name: String(deviceName || "平板"), requestedAt: Date.now() });
  return { ok: true, pending: true };
}

export function rejectPair(deviceId) {
  const had = pairing.pending.delete(deviceId);
  return { ok: true, removed: had };
}

/** 当前状态:已配对设备/待确认/文件夹注册表与共享情况 */
export async function pairStatus() {
  const status = await st("GET", "/system/status");
  const myId = status.myID;
  const devices = (await st("GET", "/config/devices")).filter((d) => d.deviceID !== myId);
  const stFolders = await st("GET", "/config/folders");
  const { folders } = loadSyncFolders();
  return {
    ok: true,
    peers: devices.map((d) => ({ id: d.deviceID, short: short(d.deviceID), name: d.name || "(未命名)", paused: !!d.paused })),
    pending: [...pairing.pending.values()].map((p) => ({ deviceId: p.deviceId, short: short(p.deviceId), name: p.name, requestedAt: p.requestedAt })),
    codeActive: !!(pairing.code && Date.now() < pairing.code.expiresAt),
    folders: folders.map((f) => {
      const stf = stFolders.find((x) => x.id === f.id);
      return {
        id: f.id, label: f.label, direction: f.direction, enabled: f.enabled,
        macPath: f.macPath, tabletPath: f.tabletPath,
        registered: !!stf, sharedWith: stf ? (stf.devices || []).filter((d) => d.deviceID !== myId).length : 0,
      };
    }),
  };
}

/** 电脑端确认:加设备 + 按勾选共享(含方向) */
export async function confirmPair(deviceId, folderChoices) {
  const pend = pairing.pending.get(deviceId);
  if (!pend) return { ok: false, error: "该设备不在待确认列表(可能已超时或已处理)" };

  await ensureSyncFolders(); // 全新 syncthing 上 folder 可能还没落地,先保证存在再共享
  await st("POST", "/config/devices", {
    deviceID: deviceId, name: pend.name, addresses: ["dynamic"], compression: "metadata",
    introducer: false, autoAcceptFolders: false, paused: false,
  });

  const { folders } = loadSyncFolders();
  const shared = [], missing = [];
  let dirty = false;
  const choices = Array.isArray(folderChoices) && folderChoices.length
    ? folderChoices
    : folders.filter((f) => f.enabled).map((f) => ({ id: f.id, direction: f.direction }));

  for (const choice of choices) {
    const reg = folders.find((f) => f.id === choice.id);
    if (!reg) { missing.push(choice.id); continue; }
    const type = DIRECTION_TO_TYPE[choice.direction || reg.direction] || "sendreceive";
    let folder;
    try { folder = await st("GET", `/config/folders/${encodeURIComponent(reg.id)}`); }
    catch { missing.push(reg.id); continue; }
    folder.devices = folder.devices || [];
    if (!folder.devices.some((d) => d.deviceID === deviceId)) {
      folder.devices.push({ deviceID: deviceId, introducedBy: "", encryptionPassword: "" });
    }
    folder.type = type;
    folder.paused = false;
    await st("PUT", `/config/folders/${encodeURIComponent(reg.id)}`, folder);
    // syncthing 的 folder.type 是文件夹级(非设备级):确认时的方向选择即写回注册表,保持单一事实源
    if (choice.direction && choice.direction !== reg.direction) { reg.direction = choice.direction; dirty = true; }
    shared.push({ id: reg.id, direction: choice.direction || reg.direction });
  }
  if (dirty) saveSyncFolders({ folders });

  pairing.pending.delete(deviceId);
  return { ok: true, device: short(deviceId), shared, missing };
}

/** 手机端拉取:自己应接受的文件夹映射(落点+镜像方向)+ 电脑端设备 ID(接受时回填) */
export async function pairMap(deviceId) {
  const { folders } = loadSyncFolders();
  let myId = null;
  try { myId = (await st("GET", "/system/status")).myID; } catch { /* syncthing 未就绪则留空,手机端重试 */ }
  return {
    ok: true,
    macDeviceId: myId,
    folders: folders.filter((f) => f.enabled).map((f) => ({
      id: f.id,
      label: f.label,
      tabletPath: f.tabletPath,
      type: MIRROR_TYPE[DIRECTION_TO_TYPE[f.direction] || "sendreceive"],
    })),
    deviceId: deviceId || null,
  };
}

/** 同步进度:每个启用文件夹对在线对端的最小完成度(谁慢看谁);无对端/全离线时标记 */
export async function syncProgress() {
  const status = await st("GET", "/system/status");
  const myId = status.myID;
  const devices = (await st("GET", "/config/devices")).filter((d) => d.deviceID !== myId && !d.paused);
  const conns = await st("GET", "/system/connections").catch(() => ({ connections: {} }));
  const onlineIds = new Set(
    Object.entries(conns.connections || {}).filter(([, v]) => v && v.connected).map(([k]) => k));
  const online = devices.filter((d) => onlineIds.has(d.deviceID));
  const { folders } = loadSyncFolders();
  const out = [];
  for (const f of folders.filter((x) => x.enabled)) {
    let completion = null, needBytes = 0;
    if (online.length) {
      const cs = await Promise.all(online.map(async (d) => {
        try { return await st("GET", `/db/completion?folder=${encodeURIComponent(f.id)}&device=${encodeURIComponent(d.deviceID)}`); }
        catch { return null; }
      }));
      const valid = cs.filter((c) => c && typeof c.completion === "number");
      if (valid.length) {
        completion = Math.min(...valid.map((c) => c.completion));
        needBytes = Math.max(...valid.map((c) => c.needBytes || 0));
      }
    }
    out.push({ id: f.id, completion, needBytes });
  }
  return { ok: true, peers: devices.length, onlinePeers: online.length, folders: out };
}

// ---------- 兼容:自动发现快速路径(保留给命令行/高级用户) ----------

export async function pairTablet(scanSeconds = 20) {
  const status = await st("GET", "/system/status");
  const myId = status.myID;
  const known = new Set((await st("GET", "/config/devices")).map((d) => d.deviceID));

  let fresh = [];
  const deadline = Date.now() + scanSeconds * 1000;
  while (Date.now() < deadline) {
    let disco = {};
    try { disco = await st("GET", "/system/discovery"); } catch { disco = {}; }
    fresh = Object.keys(disco).filter((id) => id !== myId && !known.has(id));
    if (fresh.length) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!fresh.length) {
    return { ok: false, error: "没发现新设备。请确认:①平板端安装已跑完 ②两端连同一 WiFi ③平板上 Termux/app 没被系统杀后台" };
  }
  if (fresh.length > 1) {
    return { ok: false, error: `发现 ${fresh.length} 台新设备(${fresh.map(short).join("、")}),请到 http://127.0.0.1:8384 手动选择`, candidates: fresh.map(short) };
  }

  const tablet = fresh[0];
  pairing.pending.set(tablet, { deviceId: tablet, name: "平板", requestedAt: Date.now() });
  return { ok: true, pending: true, device: short(tablet), note: "已发现设备并列入待确认,请在控制台完成确认与文件夹勾选" };
}
