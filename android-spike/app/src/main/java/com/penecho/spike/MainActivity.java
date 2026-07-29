package com.penecho.spike;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 单 APK 技术验证(FEAT-1.1.1 spike):
 * exec jniLibs 里的 node(伪装 libnode_exec.so)跑 assets/hello.mjs,
 * 轮询 127.0.0.1:8787/hello,成功即证明「Android app 内直接运行 Node 服务」可行。
 */
public class MainActivity extends Activity {

    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView status;
    private TextView log;
    private String lastErr = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 48, 32, 32);
        root.setBackgroundColor(Color.rgb(0xf2, 0xf4, 0xf7));
        status = new TextView(this);
        status.setTextSize(18);
        status.setTextColor(Color.rgb(0x22, 0x22, 0x22));
        status.setGravity(Gravity.CENTER);
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        log = new TextView(this);
        log.setTextSize(11);
        log.setTypeface(android.graphics.Typeface.MONOSPACE);
        ScrollView sv = new ScrollView(this);
        sv.addView(log);
        root.addView(sv, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        setStatus("启动内嵌 Node…");
        new Thread(this::bootAndProbe, "spike-boot").start();
    }

    private void bootAndProbe() {
        try {
            // 1. hello.mjs 与依赖库从 assets 落到 files(文件名原样,ld 按 soname 找)
            File script = new File(getFilesDir(), "hello.mjs");
            copyAsset("hello.mjs", script);
            File libsDir = new File(getFilesDir(), "libs");
            libsDir.mkdirs();
            for (String name : getAssets().list("libs")) {
                copyAsset("libs/" + name, new File(libsDir, name));
            }
            appendLog("script → " + script.getAbsolutePath() + ", libs × " + libsDir.list().length);

            // 2. node 二进制 = nativeLibraryDir/libnode_exec.so
            String libDir = getApplicationInfo().nativeLibraryDir;
            String nodeBin = libDir + "/libnode_exec.so";
            File f = new File(nodeBin);
            appendLog("node: " + nodeBin + " exists=" + f.exists() + " size=" + (f.exists() ? f.length() : 0));
            if (!f.exists()) { setStatus("❌ libnode_exec.so 不在 nativeLibraryDir(extractNativeLibs 未生效?)"); return; }
            f.setExecutable(true, true);

            // 3. exec(LD_LIBRARY_PATH 指向解压的依赖库)
            ProcessBuilder pb = new ProcessBuilder(nodeBin, script.getAbsolutePath());
            pb.environment().put("HOME", getFilesDir().getAbsolutePath());
            pb.environment().put("LD_LIBRARY_PATH", libsDir.getAbsolutePath() + ":" + libDir);
            pb.environment().put("PATH", libDir + ":/system/bin");
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            appendLog("process started");

            // 4. 读输出(后台)
            new Thread(() -> {
                try (BufferedReader r = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) appendLog("[node] " + line);
                } catch (Exception e) {
                    appendLog("[node] 输出读取结束: " + e.getMessage());
                }
            }, "spike-reader").start();

            // 5. 轮询 HTTP
            long deadline = System.currentTimeMillis() + 20_000;
            while (System.currentTimeMillis() < deadline) {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:8787/hello")
                            .openConnection(java.net.Proxy.NO_PROXY); // 模拟器系统代理会劫走回环请求
                    c.setConnectTimeout(1000);
                    c.setReadTimeout(1000);
                    if (c.getResponseCode() == 200) {
                        String body = new String(c.getInputStream().readAllBytes());
                        setStatus("✅ 单 APK 内嵌 Node 验证成功!\n" + body);
                        appendLog("HTTP 200: " + body);
                        return;
                    }
                } catch (Exception e) {
                    final String msg = e.getClass().getSimpleName() + ": " + e.getMessage();
                    if (!msg.equals(lastErr)) { lastErr = msg; appendLog("[probe] " + msg); }
                }
                Thread.sleep(700);
            }
            setStatus("❌ 20s 内 8787 未就绪——看下方进程输出");
        } catch (Exception e) {
            setStatus("❌ exec 失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            appendLog(e.toString());
        }
    }

    private void copyAsset(String name, File dest) throws java.io.IOException {
        try (InputStream in = getAssets().open(name);
             FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        }
    }

    private void setStatus(String s) { ui.post(() -> status.setText(s)); }
    private void appendLog(String s) {
        ui.post(() -> { log.append(s + "\n"); android.util.Log.i("Spike", s); });
    }
}
