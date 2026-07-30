// autosave 补丁的端到端实测(Electron 无头窗口 + 真 Chromium IndexedDB):
//   起 penecho → 模拟画线 → 等 autosave → 查 IndexedDB 有 __pi_autosave__
//   → reload → 画布像素恢复 → 清空画布 → IndexedDB 记录已删
// 跑:npx electron scripts/test-autosave-electron.mjs
import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3899;
let failures = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

// 1) 起 penecho 服务(纯白板模式,无 AI);ELECTRON_RUN_AS_NODE 把 execPath 当 node 用(血泪教训:Electron 子进程跑脚本必须设)
const server = spawn(process.execPath, [path.join(ROOT, "desktop", "penecho", "server.js")], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: String(PORT), AI_PROVIDER: "", PENECHO_DEBUG_ARTIFACTS: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[penecho] ${d}`));

async function httpOk(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const up = await fetch(url).then((r) => r.ok).catch(() => false);
    if (up) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let win; // app ready 后创建(顶层建会抛 "Cannot create BrowserWindow before app is ready")
const js = (code) => win.webContents.executeJavaScript(code, true);

app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({
      show: false, width: 1100, height: 800,
      webPreferences: { partition: "autosave-test", contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.on("console-message", (_e, _l, msg) => { if (/autosave|error/i.test(msg)) console.log("[renderer]", msg); });
    ok(await httpOk(`http://127.0.0.1:${PORT}/`), "penecho 服务就绪");
    await win.loadURL(`http://127.0.0.1:${PORT}/`);
    await new Promise((r) => setTimeout(r, 1500)); // 等 app.js 初始化(fit/主题/onboarding)

    // 画线前确保没有遗留 autosave 记录(内存 partition,理论为空;数据库本身由 refreshSnapshots 创建)
    ok(await js(`(async () => {
      const req = indexedDB.open("penecho-canvas-history", 2);
      const db = await new Promise((res) => { req.onsuccess = () => res(req.result); req.onerror = () => res(null); req.onupgradeneeded = () => res(req.result); });
      if (!db || !db.objectStoreNames.contains("snapshots")) return true;
      const item = await new Promise((res) => { const g = db.transaction("snapshots", "readonly").objectStore("snapshots").get("__pi_autosave__"); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
      return !item;
    })()`), "初始无 autosave 记录(干净环境)");

    // 2) 模拟笔画:pointerdown → 若干 pointermove → pointerup(监听在 #screen canvas 上)
    const drew = await js(`(() => {
      const cv = document.querySelector("#screen");
      const r = cv.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (x, y, type) => new PointerEvent(type, {
        clientX: x, clientY: y, pointerId: 1, pointerType: "pen", isPrimary: true,
        bubbles: true, cancelable: true, buttons: 1, pressure: 0.5,
      });
      try {
        cv.dispatchEvent(ev(cx - 80, cy - 40, "pointerdown"));
        for (let i = 1; i <= 10; i++) cv.dispatchEvent(ev(cx - 80 + i * 16, cy - 40 + i * 8, "pointermove"));
        cv.dispatchEvent(ev(cx + 80, cy + 40, "pointerup"));
        return true;
      } catch (e) { return "err:" + e.message; }
    })()`);
    ok(drew === true, "模拟笔画派发", String(drew));

    // 笔画生效确认:canvas 出现暗像素
    await new Promise((r) => setTimeout(r, 600));
    const ink = await js(`(() => {
      const c = document.querySelector("#screen");
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) dark++;
      return dark;
    })()`);
    ok(ink > 50, "笔画已落 canvas(暗像素)", `dark=${ink}`);

    // 3) 等 autosave(防抖 2.5s + 余量)后查 IndexedDB
    await new Promise((r) => setTimeout(r, 4000));
    const saved = await js(`(async () => {
      const req = indexedDB.open("penecho-canvas-history", 2);
      const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); req.onupgradeneeded = () => res(req.result); });
      if (!db.objectStoreNames.contains("snapshots")) return "no-store";
      const tx = db.transaction("snapshots", "readonly");
      const item = await new Promise((res) => { const g = tx.objectStore("snapshots").get("__pi_autosave__"); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
      if (!item) return null;
      const tileTx = db.transaction("snapshot-tiles", "readonly");
      const tiles = await new Promise((res) => { const g = tileTx.objectStore("snapshot-tiles").index("snapshotId").getAllKeys("__pi_autosave__"); g.onsuccess = () => res(g.result); g.onerror = () => res([]); });
      return { tileCount: item.tileCount, tiles: tiles.length, createdAt: item.createdAt };
    })()`);
    ok(!!saved && saved !== "no-store", "autosave 记录已写入 IndexedDB", JSON.stringify(saved));
    ok(saved?.tiles > 0, "autosave 含笔迹 tile", `tiles=${saved?.tiles}`);

    // 4) reload → 启动恢复 → 画布有非白像素
    await win.webContents.session.clearCache();
    await win.loadURL(`http://127.0.0.1:${PORT}/?t=${Date.now()}`);
    await new Promise((r) => setTimeout(r, 2500)); // 等 restoreAutosave
    const pixels = await js(`(() => {
      const c = document.querySelector("#screen");
      if (!c || !c.width) return "no-canvas";
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 16) { // 抽样:每 4 像素取一点
        if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) dark++;
      }
      return { w: c.width, h: c.height, dark };
    })()`);
    ok(typeof pixels === "object" && pixels.dark > 50, "reload 后画布笔迹已恢复", JSON.stringify(pixels));

    // 5) 清空画布(mock confirm)→ autosave 记录被删除
    await js(`(() => { window.confirm = () => true; return true; })()`);
    await js(`(() => { document.querySelector('[data-action="clear"]').click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 4000));
    const afterClear = await js(`(async () => {
      const req = indexedDB.open("penecho-canvas-history", 2);
      const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
      if (!db.objectStoreNames.contains("snapshots")) return "no-store";
      const tx = db.transaction("snapshots", "readonly");
      return await new Promise((res) => { const g = tx.objectStore("snapshots").get("__pi_autosave__"); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); });
    })()`);
    ok(afterClear === null, "清空画布后 autosave 记录已删除", JSON.stringify(afterClear));
  } catch (e) {
    console.error("测试异常:", e);
    failures++;
  } finally {
    server.kill("SIGKILL");
    console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
    app.exit(failures ? 1 : 0);
  }
});
