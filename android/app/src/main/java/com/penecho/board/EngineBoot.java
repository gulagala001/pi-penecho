package com.penecho.board;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 发动机总成引导器(FEAT-1.1.1 正式版):
 * 解压 assets/rootfs → 首配 syncthing → exec 三进程(桥/白板/同步)→ 日志落盘 → 健康探测 → 崩溃重拉。
 * 全部在 app 私有目录完成,用户无感知。
 */
public class EngineBoot {

    public interface Listener {
        void onProgress(String msg);
        void onReady();
        void onFailed(String reason);
    }

    private static final String TAG = "EngineBoot";
    private static EngineBoot instance;

    private final Context ctx;
    private final File home;        // filesDir(智能体的 HOME)
    private final File rootfs;      // filesDir/rootfs(解压物料)
    private final File libsDir;     // filesDir/rootfs/libs
    private final File logsDir;     // filesDir/logs
    private final File syncHome;    // filesDir/sync(syncthing home)
    private final List<Process> procs = new ArrayList<>();
    private volatile boolean ready = false;
    private volatile boolean stopped = false;
    private Listener listener;

    public static synchronized EngineBoot get(Context ctx) {
        if (instance == null) instance = new EngineBoot(ctx.getApplicationContext());
        return instance;
    }

    private EngineBoot(Context ctx) {
        this.ctx = ctx;
        this.home = ctx.getFilesDir();
        this.rootfs = new File(home, "rootfs");
        this.libsDir = new File(rootfs, "libs");
        this.logsDir = new File(home, "logs");
        this.syncHome = new File(home, "sync");
    }

    public boolean isReady() { return ready; }

    public synchronized void start(Listener l) {
        this.listener = l;
        if (ready) { l.onReady(); return; }
        // 端口上已是自己的服务(系统重启 service 而子进程幸存):直接视为就绪,避免重复 spawn 撞 EADDRINUSE
        if (httpOk("http://127.0.0.1:9191/health") && httpOk("http://127.0.0.1:3888/")) {
            ready = true;
            l.onReady();
            return;
        }
        if (!procs.isEmpty()) return; // 已在启动中
        stopped = false;
        new Thread(this::boot, "engine-boot").start();
    }

    public synchronized void stopAll() {
        stopped = true;
        for (Process p : procs) p.destroy();
        procs.clear();
        ready = false;
    }

    // ---------- 引导主流程 ----------

    private void boot() {
        try {
            progress("正在准备运行环境…");
            extractRootfsIfNeeded();
            ensureSyncConfig();

            String libDir = ctx.getApplicationInfo().nativeLibraryDir;
            String nodeBin = libDir + "/libnode_exec.so";
            String syncBin = libDir + "/libsyncthing_exec.so";
            new File(nodeBin).setExecutable(true, true);
            new File(syncBin).setExecutable(true, true);

            Map<String, String> baseEnv = new HashMap<>();
            baseEnv.put("HOME", home.getAbsolutePath());
            baseEnv.put("LD_LIBRARY_PATH", libsDir.getAbsolutePath() + ":" + libDir);
            baseEnv.put("PATH", libDir + ":/system/bin");
            baseEnv.put("TERM", "dumb");

            // 桥(9191)
            Map<String, String> bridgeEnv = new HashMap<>(baseEnv);
            bridgeEnv.put("PI_PENECHO_PORT", "9191");
            spawn("bridge", nodeBin, new String[]{nodeBin, new File(rootfs, "bridge/server.mjs").getAbsolutePath()}, bridgeEnv);

            // 白板 PenEcho(3888;env 注入配置,等价电脑端)
            Map<String, String> boardEnv = new HashMap<>(baseEnv);
            boardEnv.put("HOST", "127.0.0.1");
            boardEnv.put("PORT", "3888");
            boardEnv.put("AI_PROVIDER", "api");
            boardEnv.put("AI_API_FORMAT", "anthropic");
            boardEnv.put("AI_API_URL", "http://localhost:9191");
            boardEnv.put("AI_API_KEY", "managed-by-bridge");
            boardEnv.put("AI_API_MODEL", "k3");
            boardEnv.put("AI_EFFORT", "medium");
            boardEnv.put("AI_TIMEOUT_SECONDS", "300");
            boardEnv.put("PENECHO_AI_IMAGE_FORMAT", "png");
            spawn("penecho", nodeBin, new String[]{nodeBin, new File(rootfs, "penecho/server.js").getAbsolutePath()}, boardEnv);

            // 同步 syncthing(8384)
            spawn("syncthing", syncBin, new String[]{syncBin, "serve", "--no-browser", "--home", syncHome.getAbsolutePath()}, baseEnv);

            progress("正在启动智能体…");
            waitHealthy();
        } catch (Exception e) {
            Log.e(TAG, "boot failed", e);
            if (listener != null) listener.onFailed(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** assets/rootfs 全量解压(按 manifest.txt);version.txt 一致则跳过(aapt 忽略点开头文件,故不用 .version) */
    private void extractRootfsIfNeeded() throws IOException {
        String wantVer = readAssetText("rootfs/version.txt");
        File stamp = new File(rootfs, "version.txt");
        if (stamp.exists() && wantVer.equals(readFileText(stamp))) return;
        progress("首次解压运行环境(约 100MB)…");
        deleteRec(rootfs);
        rootfs.mkdirs();
        BufferedReader r = new BufferedReader(new InputStreamReader(ctx.getAssets().open("rootfs/manifest.txt")));
        String line;
        while ((line = r.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) continue;
            String rel = line.startsWith("./") ? line.substring(2) : line;
            File out = new File(rootfs, rel);
            out.getParentFile().mkdirs();
            try (InputStream in = ctx.getAssets().open("rootfs/" + rel);
                 FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) fos.write(buf, 0, n);
            }
        }
        r.close();
        try (FileWriter w = new FileWriter(stamp)) { w.write(wantVer); }
    }

    private void ensureSyncConfig() throws IOException, InterruptedException {
        syncHome.mkdirs();
        logsDir.mkdirs();
        if (new File(syncHome, "config.xml").exists()) return;
        progress("初始化同步配置…");
        String syncBin = ctx.getApplicationInfo().nativeLibraryDir + "/libsyncthing_exec.so";
        ProcessBuilder pb = new ProcessBuilder(syncBin, "generate", "--home", syncHome.getAbsolutePath());
        pb.environment().put("HOME", home.getAbsolutePath());
        pb.environment().put("LD_LIBRARY_PATH", libsDir.getAbsolutePath());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        drainTo(p, new File(logsDir, "syncthing-generate.log"));
        p.waitFor();
    }

    private void spawn(String name, String bin, String[] argv, Map<String, String> env) throws IOException {
        ProcessBuilder pb = new ProcessBuilder(argv);
        pb.environment().putAll(env);
        pb.redirectErrorStream(true);
        final Process first = pb.start();
        final Process[] holder = { first };
        procs.add(first);
        File logFile = new File(logsDir, name + ".log");
        new Thread(() -> drainTo(holder[0], logFile), "log-" + name).start();
        // 崩溃自恢复(退避重拉;stopAll 后不再重拉)
        new Thread(() -> {
            int backoff = 2;
            while (!stopped) {
                try { holder[0].waitFor(); } catch (InterruptedException ie) { return; }
                if (stopped) return;
                Log.w(TAG, name + " exited, restart in " + backoff + "s");
                appendLine(logFile, "[engine] 进程退出," + backoff + "s 后重启");
                try { Thread.sleep(backoff * 1000L); } catch (InterruptedException ie) { return; }
                backoff = Math.min(backoff * 2, 60);
                try {
                    Process np = pb.start();
                    procs.remove(holder[0]);
                    procs.add(np);
                    holder[0] = np;
                    final Process watched = np;
                    new Thread(() -> drainTo(watched, logFile), "log-" + name + "-r").start();
                    backoff = 2;
                } catch (IOException e) {
                    appendLine(logFile, "[engine] 重启失败: " + e.getMessage());
                    return;
                }
            }
        }, "watch-" + name).start();
    }

    private void waitHealthy() {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            if (httpOk("http://127.0.0.1:9191/health") && httpOk("http://127.0.0.1:3888/")) {
                ready = true;
                if (listener != null) listener.onReady();
                return;
            }
            try { Thread.sleep(800); } catch (InterruptedException ignored) { }
        }
        if (listener != null) listener.onFailed("服务 60s 未就绪(日志:" + logsDir.getAbsolutePath() + ")");
    }

    // ---------- 工具 ----------

    private void progress(String msg) {
        Log.i(TAG, msg);
        if (listener != null) listener.onProgress(msg);
    }

    private static boolean httpOk(String url) {
        java.net.HttpURLConnection c = null;
        try {
            c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(900);
            c.setReadTimeout(900);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static void drainTo(Process p, File file) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
             BufferedWriter w = new BufferedWriter(new FileWriter(file, true))) {
            String line;
            while ((line = r.readLine()) != null) {
                w.write(line); w.newLine(); w.flush();
                Log.i(TAG, "[" + file.getName() + "] " + line);
            }
        } catch (IOException ignored) { }
    }

    private static void appendLine(File f, String line) {
        try (BufferedWriter w = new BufferedWriter(new FileWriter(f, true))) { w.write(line); w.newLine(); }
        catch (IOException ignored) { }
    }

    private String readAssetText(String name) throws IOException {
        try (InputStream in = ctx.getAssets().open(name)) {
            byte[] b = new byte[in.available()];
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n) : "";
        }
    }

    private static String readFileText(File f) throws IOException {
        byte[] b = new byte[(int) f.length()];
        try (InputStream in = new java.io.FileInputStream(f)) {
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n) : "";
        }
    }

    private static void deleteRec(File f) {
        if (!f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRec(k);
        }
        f.delete();
    }
}
