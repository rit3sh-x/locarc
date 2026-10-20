package dev.locarc.app

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import dev.locarc.core.ErrorReport
import dev.locarc.core.Release
import dev.locarc.core.SyncClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest

/**
 * Keeps the process alive and owns the ongoing notification (state + top reason). Declared
 * connectedDevice|location; without background location it runs as connectedDevice only.
 */
class ScanService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watch: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val graph = applicationContext.graph
        if (!graph.paired) {
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Scanning", NotificationManager.IMPORTANCE_LOW))
        val location =
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        val types =
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                if (location) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        startForeground(ID, notification("Starting", null), types)
        val engine = graph.startEngine()
        watch?.cancel()
        watch =
            scope.launch {
                engine.state.collect { s -> manager.notify(ID, notification(s.status, s.reason)) }
            }
        return START_STICKY
    }

    private fun notification(
        status: String,
        reason: String?,
    ): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification
            .Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Locarc · $status")
            .setContentText(reason ?: "")
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    override fun onDestroy() {
        scope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "scanning"
        private const val ID = 1

        fun start(context: Context) {
            if (context.graph.paired) ContextCompat.startForegroundService(context, Intent(context, ScanService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ScanService::class.java))
        }
    }
}

/** Scanning resumes after a reboot (or an update) without anyone opening the app. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        runCatching { ScanService.start(context) }
    }
}

/** A promoted release: Wi-Fi download, SHA-256 and size check, then Android's install prompt. */
class Updater(
    private val context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var busy = false

    fun offer(release: Release) {
        if (busy || !unmetered()) return
        busy = true
        scope.launch {
            try {
                val engine = context.graph.engine.value ?: return@launch
                val sync =
                    SyncClient(
                        dev.locarc.core.ConvexHttp(context.graph.deploymentUrl ?: return@launch, dev.locarc.core.UrlConnectionTransport()),
                        engine.auth,
                    )
                val (url, sha256) = sync.downloadUrl() ?: return@launch
                val apk =
                    dev.locarc.core
                        .UrlConnectionTransport()
                        .download(url)
                val digest = MessageDigest.getInstance("SHA-256").digest(apk).joinToString("") { "%02x".format(it) }
                if (digest != sha256 || apk.size.toLong() != release.size) {
                    context.graph.report(
                        ErrorReport("UpdateRejected", "release ${release.versionName} failed its checksum", null, "updater"),
                    )
                    return@launch
                }
                install(apk)
            } catch (e: Exception) {
                context.graph.report(ErrorReport("UpdateFailed", e.message ?: "download failed", null, "updater"))
            } finally {
                busy = false
            }
        }
    }

    private fun unmetered(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun install(apk: ByteArray) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("locarc.apk", 0, apk.size.toLong()).use { it.write(apk) }
            val intent = Intent(context, InstallReceiver::class.java)
            val pending = PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            session.commit(pending.intentSender)
        }
    }
}

/** The installer asks for the Operator's confirmation (and once, "Install unknown apps"). */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm =
                if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
            confirm?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

/**
 * Crashes are written to disk before the process dies and reported on the next start, with
 * Android's exit reasons (API 30+). Tokens, secrets, emails and URL queries are stripped.
 */
object CrashReporter {
    private const val DIR = "crashes"

    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching {
                val dir = File(context.filesDir, DIR).apply { mkdirs() }
                File(
                    dir,
                    "${System.currentTimeMillis()}.txt",
                ).writeText(
                    "${e.javaClass.simpleName}\n${redact(e.message ?: "")}\n${redact(e.stackTraceToString()).take(4000)}\n${thread.name}",
                )
            }
            previous?.uncaughtException(thread, e)
        }
    }

    /** Hands every saved crash and recent abnormal exit to [report], then forgets them. */
    fun flush(
        context: Context,
        report: (ErrorReport) -> Unit,
    ) {
        File(context.filesDir, DIR).listFiles()?.forEach { f ->
            val lines = f.readText().split("\n", limit = 3)
            report(ErrorReport(lines.getOrElse(0) { "Crash" }, lines.getOrElse(1) { "" }, lines.getOrNull(2), "crash"))
            f.delete()
        }
        if (Build.VERSION.SDK_INT >= 30) {
            val prefs = context.getSharedPreferences("exits", Context.MODE_PRIVATE)
            val seen = prefs.getLong("seen", 0)
            val am = context.getSystemService(ActivityManager::class.java)
            val exits = am.getHistoricalProcessExitReasons(context.packageName, 0, 5)
            for (x in exits.filter { it.timestamp > seen }) {
                val kind =
                    when (x.reason) {
                        ApplicationExitInfo.REASON_CRASH_NATIVE -> "NativeCrash"
                        ApplicationExitInfo.REASON_ANR -> "ANR"
                        ApplicationExitInfo.REASON_LOW_MEMORY -> "LowMemoryKill"
                        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "ExcessiveResourceUsage"
                        else -> null
                    } ?: continue
                val trace = runCatching { x.traceInputStream?.use { it.readBytes().decodeToString().take(4000) } }.getOrNull()
                report(ErrorReport(kind, redact(x.description ?: kind), trace?.let(::redact), "exit"))
            }
            exits.maxOfOrNull { it.timestamp }?.let { prefs.edit().putLong("seen", it).apply() }
        }
    }

    fun redact(s: String): String =
        s
            .replace(Regex("eyJ[\\w-]+\\.[\\w-]+\\.[\\w-]+"), "<jwt>")
            .replace(Regex("[\\w.+-]+@[\\w-]+\\.[\\w.]+"), "<email>")
            .replace(Regex("\\?[^\\s\"']*"), "?<query>")
            .replace(Regex("(?i)secret[\"'=: ]+[\\w-]+"), "secret=<redacted>")
}
