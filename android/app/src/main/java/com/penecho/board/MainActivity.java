package com.penecho.board;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.DhcpInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
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
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * pi-penecho 白板壳(单 APK 形态):
 *  - 发动机(Termux)内嵌在 assets,未装时一键安装(PackageInstaller 流式,无需 androidx)
 *  - 自动在局域网发现电脑端安装门户(:9288),生成初始化命令并复制到剪贴板
 *  - 全屏 WebView 加载 127.0.0.1:3888;服务未就绪显示等待页;浮动菜单切控制台
 */
public class MainActivity extends Activity {

    private static final String TERMUX_PKG = "com.termux";
    private static final String BOARD_URL = "http://127.0.0.1:3888/";
    private static final String ADMIN_URL = "http://127.0.0.1:9191/";
    private static final String HEALTH_URL = "http://127.0.0.1:9191/health";
    private static final String CONFIG_URL = "http://127.0.0.1:9191/config";
    private static final int PORTAL_PORT = 9288; // 电脑端安装门户(server.mjs)
    private static final int WAIT_TIMEOUT_MS = 90_000;
    private static final String ACTION_INSTALL_RESULT = "com.penecho.board.INSTALL_RESULT";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View waitView;
    private TextView waitText;
    private Button btnPrimary;
    private Button btnSecondary;
    private volatile boolean keyChecked = false;
    private String macBaseUrl = null; // 局域网发现到的电脑端,如 http://192.168.5.16:9288
    private boolean pendingInstall = false;   // 去系统设置开安装权限后,回来继续装
    private boolean waitingServices = false;  // 服务探测线程在跑(防重入)
    private boolean servicesReady = false;

    private final BroadcastReceiver installResult = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_SUCCESS) {
                ui.post(() -> showInitGuide());
            } else {
                ui.post(() -> showStep("发动机安装被取消或失败。\n\n点下方按钮重试;", "重试安装", v -> installEngine()));
            }
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

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(installResult, new IntentFilter(ACTION_INSTALL_RESULT), Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(installResult, new IntentFilter(ACTION_INSTALL_RESULT));
        }

        decideFlow();
    }

    // ---------- 启动流程:装发动机 → 初始化引导 → 等服务 → 白板 ----------

    private void decideFlow() {
        if (!isInstalled(TERMUX_PKG)) {
            showStep("欢迎使用 pi-penecho 白板!\n\n还差一步:安装「发动机」(智能体在白板后面工作的环境,约 33MB)。\n\n点下面按钮,系统会问你「是否允许安装」,确认即可。",
                    "安装发动机", v -> installEngine());
        } else {
            waitForServicesWithGuide();
        }
    }

    private boolean isInstalled(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** PackageInstaller 流式安装 assets 里的 termux.apk(免 FileProvider/免 androidx) */
    private void installEngine() {
        // 安卓要求「允许本应用安装其他应用」先授权(API 26+);没有就引导去系统设置
        if (android.os.Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            showStep("还差一个权限:\n\n安卓要求你亲口允许「PenEcho 白板」安装应用。\n\n点下方按钮会跳到系统设置,把「允许来自此来源的应用」**打开**,然后按返回键回来,安装会自动继续。",
                    "去开启安装权限", v -> {
                        pendingInstall = true;
                        try {
                            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName())));
                        } catch (Exception e) {
                            // 少数 ROM 没有这个设置页:退到应用详情页让用户自己找
                            try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.parse("package:" + getPackageName()))); }
                            catch (Exception ignored) { }
                        }
                    });
            return;
        }
        showWait("正在打开发动机安装器…", null, null);
        new Thread(() -> {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.Session session = null;
            try {
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                        PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                int sessionId = installer.createSession(params);
                session = installer.openSession(sessionId);
                // 长度传 -1(未知):assets 可能被压缩存储,openFd 取长度会抛异常
                try (OutputStream out = session.openWrite("termux.apk", 0, -1);
                     InputStream in = getAssets().open("termux.apk")) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent intent = new Intent(ACTION_INSTALL_RESULT).setPackage(getPackageName());
                PendingIntent pi = PendingIntent.getBroadcast(this, sessionId, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                session.commit(pi.getIntentSender());
            } catch (Exception e) {
                if (session != null) session.abandon();
                ui.post(() -> showStep("自动安装失败(" + e.getClass().getSimpleName() + ": " + e.getMessage() + ")\n\n请把这行字拍给开发者;\n也可以手动安装:把电脑上的 termux.apk 发到本机点开。",
                        "重试", v -> installEngine()));
            }
        }, "install-engine").start();
    }

    /** 初始化引导:发现电脑端门户 → 命令复制到剪贴板 → 引导打开 Termux 粘贴 */
    private void showInitGuide() {
        showWait("正在你家 WiFi 里寻找电脑…", null, null);
        new Thread(() -> {
            String base = discoverPortal();
            macBaseUrl = base;
            ui.post(() -> {
                if (base == null) {
                    showStep("发动机装好了!\n\n没找到电脑端的安装门户。请确认:\n1. 电脑上的桥在运行(控制台 http://localhost:9191 能打开)\n2. 平板和电脑连同一个 WiFi\n\n找到后点「重试寻找」。",
                            "重试寻找", v -> showInitGuide(), "跳过,稍后在 Termux 里手动装", v -> waitForServices());
                    return;
                }
                String cmd = "curl -sL " + base + "/setup.sh | bash -s " + base + "/pi-penecho-termux-arm64.tar.gz";
                copyToClipboard(cmd);
                showStep("发动机装好了,电脑也找到了(" + base + ")!\n\n初始化命令已自动复制到剪贴板。\n\n点下方按钮打开 Termux(黑窗口),在里面长按屏幕选「粘贴」,然后按回车,等它跑完(几分钟)。",
                        "打开 Termux(命令已复制)", v -> {
                            launchTermux();
                            ui.postDelayed(this::waitForServicesWithGuide, 1500);
                        }, "我已粘贴并跑完,继续", v -> waitForServices());
            });
        }, "discover").start();
    }

    private void waitForServicesWithGuide() {
        showWait("正在连接白板服务…\n(若发动机刚初始化,请先在 Termux 里把命令跑完)", null, null);
        waitForServices();
    }

    /** 子网扫描:找监听 PORTAL_PORT 的电脑端门户 */
    private String discoverPortal() {
        try {
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

    private void launchTermux() {
        try {
            Intent it = getPackageManager().getLaunchIntentForPackage(TERMUX_PKG);
            if (it != null) startActivity(it);
        } catch (Exception ignored) { }
    }

    private void copyToClipboard(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("初始化命令", text));
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
                    showWait("白板服务连接中断。\n服务可能被系统清理,点下方按钮重试;\n一直失败请到 Termux 里运行 start.sh", "重试连接", v -> {
                        showWait("正在连接白板服务…", null, null);
                        waitForServices();
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
                .setItems(new String[]{"控制台(配置/人设)", "回到白板", "刷新页面"}, (d, which) -> {
                    if (which == 0) web.loadUrl(ADMIN_URL);
                    else if (which == 1) web.loadUrl(BOARD_URL);
                    else web.reload();
                }).show());
        return dot;
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

    // ---------- 服务探测 ----------

    private void waitForServices() {
        if (waitingServices || servicesReady) return;
        waitingServices = true;
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + WAIT_TIMEOUT_MS;
            while (System.currentTimeMillis() < deadline) {
                if (httpOk(BOARD_URL) && httpOk(HEALTH_URL)) {
                    waitingServices = false;
                    ui.post(this::onServicesReady);
                    return;
                }
                sleep(1500);
            }
            waitingServices = false;
            ui.post(() -> showStep("等了很久服务还没起来。\n\n请确认发动机的初始化命令已在 Termux 里跑完;\n然后把 Termux 电池设为「无限制」防杀后台。",
                    "重试连接", v -> { showWait("正在连接白板服务…", null, null); waitForServices(); },
                    "重新初始化引导", v -> showInitGuide()));
        }, "svc-wait").start();
    }

    private void onServicesReady() {
        servicesReady = true;
        waitView.setVisibility(View.GONE);
        web.loadUrl(BOARD_URL);
        checkApiKeyOnce();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstall) {
            // 从「允许安装应用」系统设置回来:继续装发动机
            pendingInstall = false;
            installEngine();
        } else if (waitView != null && waitView.getVisibility() == View.VISIBLE
                && isInstalled(TERMUX_PKG) && !servicesReady && !waitingServices) {
            // 从 Termux 初始化回来:自动重连服务
            showWait("正在连接白板服务…", null, null);
            waitForServices();
        }
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

    // ---------- 工具 ----------

    private static boolean httpOk(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
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

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(installResult); } catch (Exception ignored) { }
        super.onDestroy();
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }
}
