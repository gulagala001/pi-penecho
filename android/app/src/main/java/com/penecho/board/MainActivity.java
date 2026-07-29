package com.penecho.board;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.format.Formatter;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * pi-penecho 白板(单 APK 一体化):发动机(桥+白板服务+同步)内嵌,EngineBoot 全权拉起。
 * 本 Activity 只负责:全屏 WebView 显示、启动进度展示、就绪后加载白板、浮动菜单。
 */
public class MainActivity extends Activity {

    private static final String BOARD_URL = "http://127.0.0.1:3888/";
    private static final String ADMIN_URL = "http://127.0.0.1:9191/";
    private static final String CONFIG_URL = "http://127.0.0.1:9191/config";
    static final int PORTAL_PORT = 9288; // 电脑端安装门户(P3 配对发现用)

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View waitView;
    private TextView waitText;
    private Button btnPrimary;
    private Button btnSecondary;
    private volatile boolean keyChecked = false;
    private volatile boolean servicesReady = false;

    private final EngineBoot.Listener engineListener = new EngineBoot.Listener() {
        @Override public void onProgress(String msg) {
            ui.post(() -> showWait(msg, null, null));
        }
        @Override public void onReady() {
            ui.post(() -> onServicesReady());
        }
        @Override public void onFailed(String reason) {
            ui.post(() -> showStep("发动机启动失败:" + reason + "\n\n日志在 文件管理/Android/data/com.penecho.board/files/logs",
                    "重试", v -> EngineBoot.get(MainActivity.this).start(engineListener)));
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();

        root = new FrameLayout(this);
        web = buildWebView();
        waitView = buildWaitView();
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(waitView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams fabLp = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.BOTTOM | Gravity.END);
        fabLp.setMargins(0, 0, dp(16), dp(16));
        root.addView(buildFab(), fabLp);
        setContentView(root);

        // 通知权限(API 33+):前台服务通知才可见,仅提示一次
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        showWait("正在启动智能体…", null, null);
        EngineService.setUiListener(engineListener);
        Intent svc = new Intent(this, EngineService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
        else startService(svc);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 从后台回来服务仍未就绪:补一次启动(EngineBoot 幂等)
        if (!servicesReady) EngineBoot.get(this).start(engineListener);
    }

    // ---------- 视图 ----------

    private WebView buildWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false); // 白板自管触摸手势,禁止 WebView 捏合缩放干扰
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return false; // 全部站内加载,绝不跳外部浏览器
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req,
                                        android.webkit.WebResourceError error) {
                if (req.isForMainFrame()) {
                    servicesReady = false;
                    showStep("白板服务连接中断。\n可能被系统清理,点下方按钮重连;",
                            "重连", v -> {
                                showWait("正在重连…", null, null);
                                EngineBoot.get(MainActivity.this).start(engineListener);
                            });
                }
            }
        });
        return w;
    }

    /** 等待/引导页(代码布局,无 xml):标题文本 + 主按钮 + 次按钮 */
    private View buildWaitView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setBackgroundColor(Color.rgb(0xee, 0xf0, 0xf3));

        waitText = new TextView(this);
        waitText.setTextSize(16);
        waitText.setTextColor(Color.rgb(0x33, 0x33, 0x33));
        waitText.setGravity(Gravity.CENTER);
        waitText.setLineSpacing(0, 1.4f);
        box.addView(waitText);

        btnPrimary = new Button(this);
        LinearLayout.LayoutParams lp1 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp1.topMargin = dp(24);
        box.addView(btnPrimary, lp1);

        btnSecondary = new Button(this);
        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp2.topMargin = dp(12);
        box.addView(btnSecondary, lp2);
        return box;
    }

    /** 右下角半透明浮动球:控制台 / 回白板 / 刷新 */
    private View buildFab() {
        TextView dot = new TextView(this);
        dot.setText("≡");
        dot.setTextSize(20);
        dot.setTextColor(Color.WHITE);
        dot.setGravity(Gravity.CENTER);
        dot.setAlpha(0.45f);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.rgb(0x44, 0x44, 0x44));
        dot.setBackground(bg);
        dot.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setItems(new String[]{"配对电脑", "控制台(配置/人设)", "回到白板", "刷新页面"}, (d, which) -> {
                    if (which == 0) showPairFlow();
                    else if (which == 1) web.loadUrl(ADMIN_URL);
                    else if (which == 2) web.loadUrl(BOARD_URL);
                    else web.reload();
                }).show());
        return dot;
    }

    // ---------- 配对电脑(FEAT-2.2.2) ----------

    private EditText pairCodeInput;

    /** 入口:找电脑(子网扫门户;模拟器内置 10.0.2.2)→ 输码视图 */
    private void showPairFlow() {
        showWait("正在寻找电脑…", null, null);
        new Thread(() -> {
            String portal = discoverPortalBlocking();
            if (portal == null) {
                ui.post(() -> showStep("找不到电脑端。\n请确认:①电脑端程序已启动 ②本机与电脑连同一 WiFi",
                        "重试", v -> showPairFlow(),
                        "手动输入 IP", v -> promptManualIp()));
                return;
            }
            // 门户(9288)与桥(9191)同机:换端口即桥地址
            final String base = portal.replace(":" + PORTAL_PORT, ":9191");
            ui.post(() -> showCodeInput(base));
        }, "pair-discover").start();
    }

    private void promptManualIp() {
        final EditText input = new EditText(this);
        input.setHint("如 192.168.1.5");
        new AlertDialog.Builder(this)
                .setTitle("输入电脑的局域网 IP")
                .setView(input)
                .setPositiveButton("确定", (d, w) -> {
                    String ip = input.getText().toString().trim();
                    if (!ip.isEmpty()) showCodeInput("http://" + ip + ":9191");
                })
                .setNegativeButton("取消", null)
                .show();
    }

    /** 输码视图:状态文本 + 6 位码输入框(插在 waitText 之后)+ 开始/取消 */
    private void showCodeInput(String bridgeBase) {
        waitText.setText("已找到电脑:" + bridgeBase + "\n\n请在电脑端控制台点「生成配对码」,\n把 6 位码填到下面:");
        if (pairCodeInput == null) {
            pairCodeInput = new EditText(this);
            pairCodeInput.setHint("6 位配对码");
            pairCodeInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
            pairCodeInput.setGravity(Gravity.CENTER);
            pairCodeInput.setTextSize(24);
        }
        if (pairCodeInput.getParent() == null) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(220), ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(16);
            ((LinearLayout) waitView).addView(pairCodeInput, 1, lp);
        }
        pairCodeInput.setText(""); // 重试/重进时清掉残留输入
        btnPrimary.setVisibility(View.VISIBLE);
        btnPrimary.setText("开始配对");
        btnPrimary.setOnClickListener(v -> {
            String code = pairCodeInput.getText().toString().trim();
            if (code.length() != 6) { Toast.makeText(this, "请输入 6 位配对码", Toast.LENGTH_SHORT).show(); return; }
            startPair(bridgeBase, code);
        });
        btnSecondary.setVisibility(View.VISIBLE);
        btnSecondary.setText("取消");
        btnSecondary.setOnClickListener(v -> hidePairView());
        waitView.setVisibility(View.VISIBLE);
        waitView.bringToFront();
    }

    private void startPair(String bridgeBase, String code) {
        if (pairCodeInput.getParent() != null) ((LinearLayout) waitView).removeView(pairCodeInput);
        showWait("正在校验配对码…", null, null);
        new PairManager(getFilesDir()).start(bridgeBase, code, Build.MODEL, new PairManager.Callback() {
            @Override public void onState(String state, String detail) {
                ui.post(() -> waitText.setText(detail));
            }
            @Override public void onDone(String detail) {
                ui.post(() -> {
                    Toast.makeText(MainActivity.this, detail, Toast.LENGTH_LONG).show();
                    showStep(detail + "\n\n文件夹将自动开始同步。", "回到白板", v -> hidePairView());
                });
            }
            @Override public void onError(String reason) {
                ui.post(() -> showStep("配对失败:" + reason, "重试", v -> showCodeInput(bridgeBase),
                        "取消", v -> hidePairView()));
            }
        });
    }

    private void hidePairView() {
        if (pairCodeInput != null && pairCodeInput.getParent() != null)
            ((LinearLayout) waitView).removeView(pairCodeInput);
        waitView.setVisibility(View.GONE);
    }

    private void showWait(String msg, String primaryLabel, View.OnClickListener primaryAction) {
        waitText.setText(msg);
        if (primaryLabel == null) { btnPrimary.setVisibility(View.GONE); }
        else { btnPrimary.setVisibility(View.VISIBLE); btnPrimary.setText(primaryLabel); btnPrimary.setOnClickListener(primaryAction); }
        btnSecondary.setVisibility(View.GONE);
        waitView.setVisibility(View.VISIBLE);
        waitView.bringToFront();
    }

    private void showStep(String msg, String primaryLabel, View.OnClickListener primaryAction) {
        showWait(msg, primaryLabel, primaryAction);
    }

    private void showStep(String msg, String primaryLabel, View.OnClickListener primaryAction,
                          String secondaryLabel, View.OnClickListener secondaryAction) {
        showWait(msg, primaryLabel, primaryAction);
        btnSecondary.setVisibility(View.VISIBLE);
        btnSecondary.setText(secondaryLabel);
        btnSecondary.setOnClickListener(secondaryAction);
    }

    // ---------- 就绪与首次 key 检测 ----------

    private void onServicesReady() {
        servicesReady = true;
        waitView.setVisibility(View.GONE);
        web.loadUrl(BOARD_URL);
        checkApiKeyOnce();
    }

    /** 首次就绪时检测桥里有没有 API key,没有就直接带用户去控制台填 */
    private void checkApiKeyOnce() {
        if (keyChecked) return;
        keyChecked = true;
        new Thread(() -> {
            try {
                String body = httpGet(CONFIG_URL);
                boolean hasKey = body != null && !new JSONObject(body).isNull("apiKeyMasked");
                if (!hasKey) {
                    ui.post(() -> {
                        Toast.makeText(this, "请在控制台粘贴 API key 并保存(或回电脑端控制台点「配对平板」自动同步)", Toast.LENGTH_LONG).show();
                        web.loadUrl(ADMIN_URL);
                    });
                }
            } catch (Exception ignored) { /* 检测失败不打扰,用户可从浮动菜单进控制台 */ }
        }, "key-check").start();
    }

    // ---------- 电脑端门户发现(P3 配对用,保留) ----------

    /** 子网扫描:找监听 PORTAL_PORT 的电脑端门户;模拟器额外内置 10.0.2.2 */
    String discoverPortalBlocking() {
        try {
            // 模拟器:宿主电脑固定 10.0.2.2
            if (httpOk("http://10.0.2.2:" + PORTAL_PORT + "/setup.sh")) {
                return "http://10.0.2.2:" + PORTAL_PORT;
            }
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null) return null;
            DhcpInfo d = wm.getDhcpInfo();
            if (d == null || d.ipAddress == 0) return null;
            String myIp = Formatter.formatIpAddress(d.ipAddress);
            String prefix = myIp.substring(0, myIp.lastIndexOf('.') + 1);
            ExecutorService pool = Executors.newFixedThreadPool(48);
            AtomicBoolean found = new AtomicBoolean(false);
            final String[] hit = new String[1];
            for (int i = 1; i < 255; i++) {
                final String ip = prefix + i;
                if (ip.equals(myIp)) continue;
                pool.execute(() -> {
                    if (found.get()) return;
                    String base = "http://" + ip + ":" + PORTAL_PORT;
                    if (httpOk(base + "/setup.sh") && found.compareAndSet(false, true)) hit[0] = base;
                });
            }
            pool.shutdown();
            long deadline = System.currentTimeMillis() + 12_000;
            while (System.currentTimeMillis() < deadline && !found.get()) sleep(200);
            pool.shutdownNow();
            return hit[0];
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- 工具 ----------

    private static boolean httpOk(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(900);
            c.setReadTimeout(900);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String httpGet(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(java.net.Proxy.NO_PROXY);
        c.setConnectTimeout(3000);
        c.setReadTimeout(3000);
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } finally {
            c.disconnect();
        }
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    public void onBackPressed() {
        String url = web.getUrl();
        if (web.canGoBack()) web.goBack();
        else if (url == null || !url.startsWith(BOARD_URL)) web.loadUrl(BOARD_URL);
        else super.onBackPressed();
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }
}
