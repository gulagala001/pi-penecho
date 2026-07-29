// pi-penecho 电脑端(Electron main):桥+PenEcho+syncthing 以 ELECTRON_RUN_AS_NODE 子进程组拉起,
// 窗口加载控制台 localhost:9191。已在跑的服务(launchd 等)直接复用不重起;自己 spawn 的退出时回收。
import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV = !app.isPackaged;
// 物料根:开发=仓库根;打包=Resources/app(asar:false,文件散装进 app/)
const ROOT = DEV ? path.join(__dirname, "..") : path.join(process.resourcesPath, "app");
const LOG_DIR = path.join(os.homedir(), ".pi-penecho", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const BRIDGE_BUNDLE = path.join(ROOT, "desktop", "bridge-bundle.mjs");
const PENECHO_ENTRY = path.join(ROOT, "desktop", "penecho", "server.js");
const SYNCTHING_BIN = path.join(ROOT, "desktop", "bin", process.platform === "win32" ? "syncthing.exe" : "syncthing");
const ST_HOME = path.join(os.homedir(), ".config", "syncthing");

const children = []; // 本进程 spawn 的子进程(退出时回收;外部已跑的不碰)

function httpOk(url, ms = 900) {
  return new Promise((resolve) => {
    const req = fetch(url, { signal: AbortSignal.timeout(ms) }).then((r) => resolve(r.ok)).catch(() => resolve(false));
    req.catch?.(() => {});
  }).catch(() => false);
}

/** spawn 并落日志;崩了退避重拉(与手机端 EngineBoot 同哲学) */
function spawnLogged(name, cmd, args, env) {
  const logFile = path.join(LOG_DIR, `${name}.log`);
  let backoff = 1000;
  const start = () => {
    const out = fs.createWriteStream(logFile, { flags: "a" });
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.pipe(out); p.stderr.pipe(out);
    p.on("error", (e) => fs.appendFileSync(logFile, `[desktop] spawn 失败: ${e.message}\n`));
    p.on("exit", (code) => {
      fs.appendFileSync(logFile, `[desktop] 进程退出 code=${code}, ${backoff}ms 后重拉\n`);
      const idx = children.indexOf(p); if (idx >= 0) children.splice(idx, 1);
      if (!quitting) setTimeout(() => { if (!quitting) start(); }, backoff);
      backoff = Math.min(backoff * 2, 30000);
    });
    children.push(p);
    backoff = 1000;
  };
  start();
}

async function waitHealthy(name, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await httpOk(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`[desktop] ${name} 60s 未就绪,继续开窗口(控制台可查看状态)`);
  return false;
}

let quitting = false;

async function boot() {
  // 1) 桥(9191):已在跑(launchd/手动)则复用
  if (!(await httpOk("http://127.0.0.1:9191/health"))) {
    if (!fs.existsSync(BRIDGE_BUNDLE)) {
      console.error("[desktop] 缺桥 bundle: 先跑 scripts/build-desktop.sh");
    } else {
      spawnLogged("bridge", process.execPath, [BRIDGE_BUNDLE], {
        ELECTRON_RUN_AS_NODE: "1",
        PI_PENECHO_PORT: "9191",
        PI_PENECHO_ADMIN_HTML: path.join(ROOT, "public", "admin.html"),
        PI_PENECHO_DIST_DIR: path.join(ROOT, "dist"),
      });
    }
  }
  // 2) PenEcho 白板(3888)
  if (!(await httpOk("http://127.0.0.1:3888/"))) {
    spawnLogged("penecho", process.execPath, [PENECHO_ENTRY], {
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1", PORT: "3888",
      AI_PROVIDER: "api", AI_API_FORMAT: "anthropic",
      AI_API_URL: "http://localhost:9191", AI_API_KEY: "managed-by-bridge",
      AI_API_MODEL: "k3", AI_EFFORT: "medium", AI_TIMEOUT_SECONDS: "300",
      PENECHO_AI_IMAGE_FORMAT: "png",
    });
  }
  // 3) syncthing(8384;v2 CLI;首次自动 generate)
  if (!(await httpOk("http://127.0.0.1:8384/"))) {
    if (fs.existsSync(SYNCTHING_BIN)) {
      if (!fs.existsSync(path.join(ST_HOME, "config.xml"))) {
        fs.mkdirSync(ST_HOME, { recursive: true });
        spawn(SYNCTHING_BIN, ["generate", "--home", ST_HOME], { stdio: "ignore" }).on("exit", () => {
          spawnLogged("syncthing", SYNCTHING_BIN, ["serve", "--no-browser", "--home", ST_HOME], {});
        });
      } else {
        spawnLogged("syncthing", SYNCTHING_BIN, ["serve", "--no-browser", "--home", ST_HOME], {});
      }
    } else console.error("[desktop] 缺 syncthing 二进制: 先跑 scripts/build-desktop.sh");
  }

  await waitHealthy("桥", "http://127.0.0.1:9191/health");

  const win = new BrowserWindow({
    width: 1280, height: 840, title: "pi-penecho",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  // 外部链接走系统浏览器,窗口内不跳转
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.loadURL("http://localhost:9191/");
}

app.whenReady().then(boot);
app.on("before-quit", () => {
  quitting = true;
  for (const p of children) { try { p.kill(); } catch { /* 已退 */ } }
});
app.on("window-all-closed", () => app.quit());
