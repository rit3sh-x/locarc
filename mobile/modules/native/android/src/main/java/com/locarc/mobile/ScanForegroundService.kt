package com.locarc.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

class ScanForegroundService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        createChannel()
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("HackRF scan running")
            .setContentText("Sweeping — tap to return to app.")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID, notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notif)
        }

        acquireWakeLock()
        Log.i(TAG, "ScanForegroundService started")
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        Log.i(TAG, "ScanForegroundService stopped")
        super.onDestroy()
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "locarc:HackrfScan")
        wl.setReferenceCounted(false)
        wl.acquire(10 * 60 * 1000L)
        wakeLock = wl
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {
            Log.w(TAG, "wake lock release failed: ${e.message}")
        }
        wakeLock = null
    }

    private fun createChannel() {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
            val ch = NotificationChannel(
                CHANNEL_ID, "HackRF Scan",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps HackRF scan alive when app is backgrounded."
                setShowBadge(false)
            }
            mgr.createNotificationChannel(ch)
        }
    }

    companion object {
        private const val TAG = "ScanForegroundService"
        private const val CHANNEL_ID = "hackrf_scan"
        private const val NOTIFICATION_ID = 0xC0FE
        private const val ACTION_STOP = "com.locarc.mobile.action.STOP_SCAN"

        fun start(ctx: Context) {
            val intent = Intent(ctx, ScanForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            val intent = Intent(ctx, ScanForegroundService::class.java)
                .setAction(ACTION_STOP)
            try {
                ctx.startService(intent)
            } catch (e: Exception) {
                Log.w(TAG, "stop intent dispatch failed: ${e.message}")
            }
        }
    }
}
