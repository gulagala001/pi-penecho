// PenEcho 上游源码补丁(幂等):npm pack 解包后执行,升级 penecho 版本后重跑即可
// ① 画布会话持久化(autosave):刷新/跳走/重开不丢画布,复用 IndexedDB 快照机制
// ② 顶栏 flex-wrap:窄窗口不再把右上角语言/主题/教程按钮挤出可视区
// 用法:node scripts/patch-penecho.mjs [penecho目录]   (默认 desktop/penecho;rootfs 构建时传 android/.../rootfs/penecho)
// 锚点全部来自 penecho@0.7.1;上游升级导致锚点漂移时会显式报错(不许静默跳过)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.resolve(ROOT, process.argv[2] || "desktop/penecho");
const MARK = "__PI_PENECHO_PATCH__";

// autosave 模块:注入在 save() 定义前(save() 是所有内容变更的 undo 记录点,兼作变更挂钩)
const AUTOSAVE_MODULE = `  // ${MARK} autosave:画布会话持久化(刷新/跳走/重开自动恢复)
  const AUTOSAVE_ID = "__pi_autosave__";
  let autosaveDirty = false, autosaveTimer = 0, autosaveBusy = false;
  async function deleteAutosaveRecord() {
    try {
      const db = await snapshotDb(),
        readTx = db.transaction(SNAPSHOT_TILE_STORE, "readonly"),
        tileKeys = await requestResult(readTx.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(AUTOSAVE_ID)),
        tx = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
      tx.objectStore(SNAPSHOT_STORE).delete(AUTOSAVE_ID);
      tileKeys.forEach((k) => tx.objectStore(SNAPSHOT_TILE_STORE).delete(k));
      await transactionDone(tx);
    } catch (e) { console.warn("[autosave] 删除失败", e); }
  }
  async function autosaveFlush() {
    if (autosaveBusy || !autosaveDirty) return;
    autosaveDirty = false;
    if (typeof selectionAIBusy === "function" && selectionAIBusy()) { autosaveDirty = true; return; } // AI 处理中,下轮再存
    autosaveBusy = true;
    try {
      const empty = !tiles.size && !state.images.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length;
      if (empty) await deleteAutosaveRecord();
      else await saveSnapshot({ overwriteId: AUTOSAVE_ID, name: "(自动保存)", quiet: true });
    } catch (e) { console.warn("[autosave] 保存失败", e); autosaveDirty = true; }
    finally { autosaveBusy = false; }
  }
  function autosaveSchedule() {
    autosaveDirty = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveFlush, 2500);
  }
  async function restoreAutosave() {
    try {
      const db = await snapshotDb(),
        item = await requestResult(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).get(AUTOSAVE_ID));
      if (!item) return;
      await loadSnapshot(AUTOSAVE_ID);
      // 恢复后当作未命名画布继续编辑,不污染手动快照的覆盖目标
      if (state.currentSnapshotId === AUTOSAVE_ID) { state.currentSnapshotId = null; state.currentSnapshotName = ""; }
      console.log("[autosave] 已恢复上次画布");
    } catch (e) { console.warn("[autosave] 恢复失败", e); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearTimeout(autosaveTimer); autosaveFlush(); }
  });
  window.addEventListener("beforeunload", () => { clearTimeout(autosaveTimer); autosaveFlush(); });
  // ${MARK} end

`;

const PATCHES = [
  {
    file: "public/app.js",
    edits: [
      {
        name: "saveSnapshot 加 quiet 参数",
        anchor: "  async function saveSnapshot({ overwriteId = null, name = null } = {}) {",
        replacement: "  async function saveSnapshot({ overwriteId = null, name = null, quiet = false } = {}) { // " + MARK,
      },
      {
        name: "quiet 时不提交选区/不闪状态(开头守卫)",
        anchor: `    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (state.selection) commitSelection();`,
        replacement: `    if (selectionAIBusy()) {
      if (quiet) return null; // ${MARK}
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (state.selection) { if (quiet) return null; commitSelection(); }`,
      },
      {
        name: "quiet 豁免 noCurrentSnapshot(autosave 首次写入时历史缓存里没有)",
        anchor: '    if (overwriteId && !existing && overwriteId !== state.currentSnapshotId) throw Error(t("noCurrentSnapshot"));',
        replacement: '    if (!quiet && overwriteId && !existing && overwriteId !== state.currentSnapshotId) throw Error(t("noCurrentSnapshot")); // ' + MARK,
      },
      {
        name: "quiet 跳过尾部副作用(状态栏/历史面板/覆盖目标)",
        anchor: `    nameInput.value = "";
    state.currentSnapshotId = id;
    state.currentSnapshotName = snapshotName(item);
    await refreshSnapshots();
    setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
    return id;`,
        replacement: `    if (!quiet) { // ${MARK}
      nameInput.value = "";
      state.currentSnapshotId = id;
      state.currentSnapshotName = snapshotName(item);
      await refreshSnapshots();
      setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
    }
    return id;`,
      },
      {
        name: "注入 autosave 模块(save 定义前)",
        anchor: "  function save() {",
        replacement: AUTOSAVE_MODULE + "  function save() { // " + MARK + " hook",
      },
      {
        name: "save() 挂钩:内容变化调度 autosave",
        anchor: `  function save() { // ${MARK} hook
    if (!state.historyBefore.size`,
        replacement: `  function save() { // ${MARK} hook
    autosaveSchedule();
    if (!state.historyBefore.size`,
      },
      {
        name: "新建空白画布时清除 autosave",
        anchor: `    state.currentSnapshotId = null;
    state.currentSnapshotName = "";
    state.viewInitialized = false;`,
        replacement: `    state.currentSnapshotId = null;
    state.currentSnapshotName = "";
    deleteAutosaveRecord(); autosaveDirty = false; // ${MARK}
    state.viewInitialized = false;`,
      },
      {
        name: "历史面板过滤 autosave 记录",
        anchor: `      items = await requestResult(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);`,
        replacement: `      items = await requestResult(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
    return items.filter((it) => it.id !== "__pi_autosave__").sort((a, b) => b.createdAt - a.createdAt); // ${MARK}`,
      },
      {
        name: "启动时恢复上次画布",
        anchor: `  refreshSnapshots().catch(() => {});
  fit();
  requestAnimationFrame(() => requestAnimationFrame(maybeStartOnboarding));`,
        replacement: `  refreshSnapshots().catch(() => {});
  restoreAutosave().catch(() => {}); // ${MARK}
  fit();
  requestAnimationFrame(() => requestAnimationFrame(maybeStartOnboarding));`,
      },
    ],
  },
  {
    file: "public/style.css",
    edits: [
      {
        name: "顶栏换行:窄窗口不挤丢右上角按钮",
        anchor: ".top-row { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 0; }",
        replacement: ".top-row { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 0; flex-wrap: wrap; } /* " + MARK + " */",
      },
    ],
  },
];

let applied = 0, skipped = 0;
for (const { file, edits } of PATCHES) {
  const fp = path.join(TARGET, file);
  if (!fs.existsSync(fp)) { console.error(`✗ 缺文件: ${fp}`); process.exit(1); }
  let src = fs.readFileSync(fp, "utf8");
  let dirty = false;
  for (const { name, anchor, replacement } of edits) {
    if (src.includes(replacement)) { skipped++; continue; } // 幂等:已打过
    const hits = src.split(anchor).length - 1;
    if (hits !== 1) {
      console.error(`✗ 锚点${hits === 0 ? "未命中" : "不唯一"}(${hits}): [${name}] in ${file}`);
      console.error("  上游可能已升级,请核对锚点后更新 patch 脚本");
      process.exit(1);
    }
    src = src.replace(anchor, replacement);
    dirty = true;
    applied++;
    console.log(`  ✓ [${file}] ${name}`);
  }
  if (dirty) fs.writeFileSync(fp, src);
}
console.log(`patch 完成: 新应用 ${applied} 处, 幂等跳过 ${skipped} 处 (${path.relative(ROOT, TARGET)})`);
