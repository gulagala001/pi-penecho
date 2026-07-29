package com.penecho.board;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 手机端配对(FEAT-2.2.2):读本机 syncthing deviceID → 电脑端 redeem 配对码 →
 * 轮询确认 → 拉 /pair/map → 本地 syncthing 逐个接受文件夹(落点+镜像方向)。
 */
public class PairManager {

    public interface Callback {
        void onState(String state, String detail);
        void onDone(String detail);
        void onError(String reason);
    }

    private final File home;
    private final File syncHome;

    public PairManager(File home) {
        this.home = home;
        this.syncHome = new File(home, "sync");
    }

    // ---------- 本地 syncthing ----------

    private String readConfig() throws Exception {
        File f = new File(syncHome, "config.xml");
        byte[] b = new byte[(int) f.length()];
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n, StandardCharsets.UTF_8) : "";
        }
    }

    public String getSyncDeviceId() throws Exception {
        // 本机 ID 以 REST /system/status 为准——config.xml 里 <device> 顺序不保证本机第一
        // (接受过电脑端设备后,正则取第一个会误拿对端 ID,把 Mac 加成自己的对端)
        try {
            HttpURLConnection c = conn("http://127.0.0.1:8384/rest/system/status", getSyncApiKey());
            if (c.getResponseCode() == 200) {
                String myId = new JSONObject(readAll(c)).optString("myID", null);
                if (myId != null && !myId.isEmpty()) return myId;
            }
        } catch (Exception ignored) { /* syncthing 未就绪则走回退 */ }
        Matcher m = Pattern.compile("<device id=\"([^\"]+)\"").matcher(readConfig());
        return m.find() ? m.group(1) : null;
    }

    private String getSyncApiKey() throws Exception {
        Matcher m = Pattern.compile("<apikey>([^<]+)</apikey>").matcher(readConfig());
        return m.find() ? m.group(1) : null;
    }

    // ---------- 流程 ----------

    public void start(String bridgeBase, String code, String deviceName, Callback cb) {
        new Thread(() -> {
            try {
                String deviceId = getSyncDeviceId();
                if (deviceId == null) { cb.onError("本机同步配置未就绪(发动机刚装?稍候重试)"); return; }

                // 1) 核销配对码
                cb.onState("redeem", "正在校验配对码…");
                JSONObject req = new JSONObject();
                req.put("code", code);
                req.put("deviceId", deviceId);
                req.put("deviceName", deviceName);
                JSONObject resp = postJson(bridgeBase + "/pair/redeem", req);
                if (!resp.optBoolean("ok")) { cb.onError(resp.optString("error", "配对码无效")); return; }
                boolean alreadyPaired = resp.optBoolean("alreadyPaired");

                // 2) 等待电脑端确认(最长 10 分钟;已配对设备跳过,直接同步文件夹设置)
                boolean confirmed = alreadyPaired;
                if (!alreadyPaired) {
                    cb.onState("waiting", "已提交,请在电脑端控制台点「确认配对」…");
                    long deadline = System.currentTimeMillis() + 10 * 60 * 1000;
                    while (System.currentTimeMillis() < deadline) {
                        JSONObject st = getJson(bridgeBase + "/pair/status");
                        if (st.optBoolean("ok")) {
                            if (containsId(st.optJSONArray("peers"), deviceId)) { confirmed = true; break; }
                            if (!containsId(st.optJSONArray("pending"), deviceId)) {
                                cb.onError("配对请求已被电脑端拒绝或超时");
                                return;
                            }
                        }
                        Thread.sleep(3000);
                    }
                    if (!confirmed) { cb.onError("等待确认超时(10 分钟)"); return; }
                }

                // 3) 拉映射,本地接受文件夹
                cb.onState("accept", "电脑已确认,正在建立同步…");
                JSONObject map = getJson(bridgeBase + "/pair/map?deviceId=" + deviceId);
                String macId = map.optString("macDeviceId", null);
                String apiKey = getSyncApiKey();
                JSONArray folders = map.optJSONArray("folders");
                int accepted = 0;
                if (macId != null && !deviceKnown(apiKey, macId)) {
                    // 注册电脑端设备(folder 共享的前提:设备须先存在于本机配置)
                    JSONObject dev = new JSONObject();
                    dev.put("deviceID", macId);
                    dev.put("name", "电脑");
                    dev.put("addresses", new JSONArray().put("dynamic"));
                    dev.put("compression", "metadata");
                    dev.put("introducer", false);
                    dev.put("paused", false);
                    syncPost(apiKey, "/rest/config/devices", dev);
                }
                if (folders != null && macId != null) {
                    for (int i = 0; i < folders.length(); i++) {
                        JSONObject f = folders.getJSONObject(i);
                        String id = f.getString("id");
                        String wantType = f.optString("type", "sendreceive");
                        String existingType = getFolderType(apiKey, id);
                        if (existingType != null) {
                            if (!wantType.equals(existingType)) {
                                syncPut(apiKey, "/rest/config/folders/" + id, "type", wantType); // 方向变更跟随
                            }
                            accepted++;
                            continue;
                        }
                        JSONObject body = new JSONObject();
                        body.put("id", id);
                        body.put("label", f.optString("label", id));
                        body.put("path", expandHome(f.getString("tabletPath")));
                        body.put("type", wantType);
                        body.put("rescanIntervalS", 30);
                        body.put("fsWatcherEnabled", true);
                        body.put("ignorePerms", true);
                        body.put("paused", false);
                        JSONArray devs = new JSONArray();
                        devs.put(new JSONObject().put("deviceID", macId));
                        body.put("devices", devs);
                        syncPost(apiKey, "/rest/config/folders", body);
                        accepted++;
                    }
                }
                cb.onDone("配对完成 ✓ 已建立 " + accepted + " 个同步文件夹");
            } catch (Exception e) {
                cb.onError(e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }, "pair-flow").start();
    }

    // ---------- HTTP 工具 ----------

    private static boolean containsId(JSONArray arr, String id) {
        if (arr == null || id == null) return false;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && id.equals(o.optString("id", o.optString("deviceId")))) return true;
        }
        return false;
    }

    private boolean deviceKnown(String apiKey, String id) {
        try {
            HttpURLConnection c = conn("http://127.0.0.1:8384/rest/config/devices/" + id, apiKey);
            return c.getResponseCode() == 200;
        } catch (Exception e) { return false; }
    }

    private String getFolderType(String apiKey, String id) {
        try {
            HttpURLConnection c = conn("http://127.0.0.1:8384/rest/config/folders/" + id, apiKey);
            if (c.getResponseCode() != 200) return null;
            return new JSONObject(readAll(c)).optString("type", null);
        } catch (Exception e) { return null; }
    }

    /** syncthing folder 顶层字段局部更新(先 GET 再 PUT 全量,只改一个字段) */
    private void syncPut(String apiKey, String path, String key, String value) throws Exception {
        HttpURLConnection g = conn("http://127.0.0.1:8384" + path, apiKey);
        if (g.getResponseCode() != 200) throw new Exception("syncthing GET " + path + " → " + g.getResponseCode());
        JSONObject folder = new JSONObject(readAll(g));
        folder.put(key, value);
        HttpURLConnection c = conn("http://127.0.0.1:8384" + path, apiKey);
        c.setRequestMethod("PUT");
        c.setRequestProperty("Content-Type", "application/json");
        c.setDoOutput(true);
        try (OutputStream o = c.getOutputStream()) {
            o.write(folder.toString().getBytes(StandardCharsets.UTF_8));
        }
        if (c.getResponseCode() >= 400) throw new Exception("syncthing PUT " + path + " → " + c.getResponseCode());
    }

    private String expandHome(String p) {
        if (p == null) return home.getAbsolutePath();
        return p.startsWith("~") ? home.getAbsolutePath() + p.substring(1) : p;
    }

    private static HttpURLConnection conn(String url, String apiKey) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(java.net.Proxy.NO_PROXY);
        c.setConnectTimeout(5000);
        c.setReadTimeout(5000);
        if (apiKey != null) c.setRequestProperty("X-API-Key", apiKey);
        return c;
    }

    private static JSONObject getJson(String url) throws Exception {
        HttpURLConnection c = conn(url, null);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        return new JSONObject(readAll(c));
    }

    private static JSONObject postJson(String url, JSONObject body) throws Exception {
        HttpURLConnection c = conn(url, null);
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "application/json");
        c.setDoOutput(true);
        try (OutputStream o = c.getOutputStream()) {
            o.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        String text = code < 400 ? readAll(c) : readAllErr(c);
        return new JSONObject(text.isEmpty() ? "{}" : text);
    }

    private void syncPost(String apiKey, String path, JSONObject body) throws Exception {
        HttpURLConnection c = conn("http://127.0.0.1:8384" + path, apiKey);
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "application/json");
        c.setDoOutput(true);
        try (OutputStream o = c.getOutputStream()) {
            o.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        if (c.getResponseCode() >= 400) throw new Exception("syncthing " + path + " → " + c.getResponseCode());
    }

    private static String readAll(HttpURLConnection c) throws Exception {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        }
    }

    private static String readAllErr(HttpURLConnection c) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getErrorStream(), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Exception e) { return ""; }
    }
}
