package com.penecho.board;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 发动机前台服务(FEAT-1.1.2):常驻通知声明「白板服务运行中」,
 * 把 EngineBoot 的子进程组纳入系统认可的前台生命周期,降低被清理概率。
 */
public class EngineService extends Service {

    private static final String CHANNEL_ID = "engine";
    private static final int NOTIF_ID = 1;

    private static EngineBoot.Listener uiListener;
    /** MainActivity 注册进度/就绪回调(静态单例,app 内自产自销) */
    public static void setUiListener(EngineBoot.Listener l) { uiListener = l; }

    private final EngineBoot.Listener relay = new EngineBoot.Listener() {
        @Override public void onProgress(String msg) { if (uiListener != null) uiListener.onProgress(msg); }
        @Override public void onReady() { if (uiListener != null) uiListener.onReady(); }
        @Override public void onFailed(String reason) { if (uiListener != null) uiListener.onFailed(reason); }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "白板服务", NotificationManager.IMPORTANCE_LOW));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        Notification n = b.setContentTitle("PenEcho 白板服务运行中")
                .setContentText("智能体在后台待命,点我返回白板")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }

        EngineBoot.get(this).start(relay);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        EngineBoot.get(this).stopAll();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
