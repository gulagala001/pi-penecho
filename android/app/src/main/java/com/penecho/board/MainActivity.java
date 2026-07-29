package com.penecho.board;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * PenEcho 白板壳:全屏 WebView 加载本机 Termux 里的 PenEcho(3888) 与桥控制台(9191)。
 * 职责:等服务就绪、首次无 key 自动引导到控制台、浮动菜单切换页面。
 * 服务本身由 Termux 里的 start.sh 维护,壳不参与生命周期。
 */
public class MainActivity extends Activity {

    private static final String BOARD_URL = "http://127.0.0.1:3888/";
    private static final String ADMIN_URL = "http://127.0.0.1:9191/";
    private static final String HEALTH_URL = "http://127.0.0.1:9191/health";
    private static final String CONFIG_URL = "http://127.0.0.1:9191/config";
    private static final int WAIT_TIMEOUT_MS = 90_000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View waitView;
    private TextView waitText;
    private volatile boolean keyChecked = false;

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

        showWait("正在连接白板服务…");
        waitForServices();
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
                    showWait("白板服务连接中断。\n服务可能被系统清理,点下方按钮重试;\n一直失败请到 Termux 里运行 start.sh");
                }
            }
        });
        return w;
    }

    /** 服务未就绪时的原生等待页(代码布局,无 xml) */
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

        Button retry = new Button(this);
        retry.setText("重试连接");
        retry.setOnClickListener(v -> {
            showWait("正在连接白板服务…");
            waitForServices();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(24);
        box.addView(retry, lp);
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
        FrameLayout.LayoutParams mlp = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.BOTTOM | Gravity.END);
        mlp.setMargins(0, 0, dp(16), dp(16));
        dot.setLayoutParams(mlp);
        dot.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setItems(new String[]{"控制台(配置/人设)", "回到白板", "刷新页面"}, (d, which) -> {
                    if (which == 0) web.loadUrl(ADMIN_URL);
                    else if (which == 1) web.loadUrl(BOARD_URL);
                    else web.reload();
                }).show());
        return dot;
    }

    // ---------- 服务探测 ----------

    private void waitForServices() {
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + WAIT_TIMEOUT_MS;
            while (System.currentTimeMillis() < deadline) {
                if (httpOk(BOARD_URL) && httpOk(HEALTH_URL)) {
                    ui.post(this::onServicesReady);
                    return;
                }
                sleep(1500);
            }
            ui.post(() -> showWait("等了很久服务还没起来。\n\n请确认:\n1. 已装 Termux 并运行过一键安装脚本\n"
                    + "2. Termux 没被系统杀后台(电池设成「无限制」)\n\n然后点「重试连接」"));
        }, "svc-wait").start();
    }

    private void onServicesReady() {
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
                        Toast.makeText(this, "首次使用:请在控制台粘贴 Kimi API key 并保存", Toast.LENGTH_LONG).show();
                        web.loadUrl(ADMIN_URL);
                    });
                }
            } catch (Exception ignored) { /* 检测失败不打扰,用户可从浮动菜单进控制台 */ }
        }, "key-check").start();
    }

    // ---------- 工具 ----------

    private void showWait(String msg) {
        waitText.setText(msg);
        waitView.setVisibility(View.VISIBLE);
        waitView.bringToFront();
    }

    private static boolean httpOk(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(2000);
            c.setReadTimeout(2000);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String httpGet(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
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
