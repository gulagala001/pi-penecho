// 平板配对:发现局域网内未配对的 Syncthing 设备,加为远程设备并把共享文件夹分给它
// 与 scripts/pair-tablet.sh 等价,供控制台 HTTP 调用;Syncthing 未安装时返回明确错误
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ST_HOME = path.join(os.homedir(), ".config", "syncthing");
const API = "http://127.0.0.1:8384/rest";

// 要共享给平板的文件夹 id(空格分隔,env 可覆盖;install-syncthing-mac.sh 负责创建它们)
export const PAIR_FOLDERS = (process.env.PENECHO_PAIR_FOLDERS || "kaoyan-new pi-penecho-config")
  .split(/\s+/).filter(Boolean);

function readApiKey() {
  try {
    const xml = fs.readFileSync(path.join(ST_HOME, "config.xml"), "utf8");
    return xml.match(/<apikey>([^<]+)<\/apikey>/)?.[1] || null;
  } catch { return null; }
}

async function st(method, p, body) {
  const key = readApiKey();
  if (!key) throw new Error("Syncthing 未安装或未初始化 — 请先在 Mac 上运行 scripts/install-syncthing-mac.sh");
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

/** 当前配对状态:已配对的远程设备 + 各文件夹共享情况 */
export async function pairStatus() {
  const status = await st("GET", "/system/status");
  const myId = status.myID;
  const devices = (await st("GET", "/config/devices")).filter((d) => d.deviceID !== myId);
  const folders = await st("GET", "/config/folders");
  return {
    ok: true,
    peers: devices.map((d) => ({ id: short(d.deviceID), name: d.name || "(未命名)", paused: !!d.paused })),
    folders: folders.map((f) => ({
      id: f.id,
      sharedWith: (f.devices || []).filter((d) => d.deviceID !== myId).length,
      paused: !!f.paused,
    })),
  };
}

/** 发现局域网新设备并完成配对;scanSeconds 内轮询本地发现表 */
export async function pairTablet(scanSeconds = 20) {
  const status = await st("GET", "/system/status");
  const myId = status.myID;
  const known = new Set((await st("GET", "/config/devices")).map((d) => d.deviceID));

  // 轮询本地发现(广播周期约 30s,前几次通常就能命中)
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
    return { ok: false, error: "没发现新设备。请确认:①平板端一键安装已跑完 ②两端连同一 WiFi ③平板上 Termux 没被系统杀后台", peers: (await pairStatus()).peers };
  }
  if (fresh.length > 1) {
    return { ok: false, error: `发现 ${fresh.length} 台新设备(${fresh.map(short).join("、")}),请到 http://127.0.0.1:8384 手动选择你的平板`, candidates: fresh.map(short) };
  }

  const tablet = fresh[0];
  await st("POST", "/config/devices", {
    deviceID: tablet, name: "平板", addresses: ["dynamic"], compression: "metadata",
    introducer: false, autoAcceptFolders: false, paused: false,
  });

  const shared = [], missing = [];
  for (const fid of PAIR_FOLDERS) {
    let folder;
    try { folder = await st("GET", `/config/folders/${encodeURIComponent(fid)}`); }
    catch { missing.push(fid); continue; }
    folder.devices = folder.devices || [];
    if (!folder.devices.some((d) => d.deviceID === tablet)) {
      folder.devices.push({ deviceID: tablet, introducedBy: "", encryptionPassword: "" });
    }
    folder.paused = false;
    await st("PUT", `/config/folders/${encodeURIComponent(fid)}`, folder);
    shared.push(fid);
  }

  return {
    ok: true,
    device: short(tablet),
    shared,
    missing, // 这些文件夹在 Syncthing 里不存在,提示补跑 install 脚本
    note: "配对已发起;平板上的配对守护会在约 10 秒内自动接受并开始同步。",
  };
}
