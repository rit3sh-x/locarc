package dev.locarc.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dev.locarc.core.Conditions
import dev.locarc.core.PositionFix

/** Battery, charging, thermal status and the setup gaps, pushed whenever one changes. */
class PhoneConditions(
    private val context: Context,
) {
    private var receiver: BroadcastReceiver? = null
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
    private var sink: ((Conditions) -> Unit)? = null
    private var battery = 1.0
    private var charging = true
    private var thermal = "none"
    private val prefs = context.getSharedPreferences("setup", Context.MODE_PRIVATE)

    fun start(onChange: (Conditions) -> Unit) {
        sink = onChange
        val r =
            object : BroadcastReceiver() {
                override fun onReceive(
                    c: Context,
                    i: Intent,
                ) {
                    val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                    val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                    if (level >= 0) battery = level.toDouble() / scale
                    charging = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
                    push()
                }
            }
        receiver = r
        context.registerReceiver(r, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val pm = context.getSystemService(PowerManager::class.java)
        val l =
            PowerManager.OnThermalStatusChangedListener {
                thermal = THERMAL.getOrElse(it) { "shutdown" }
                push()
            }
        thermalListener = l
        pm.addThermalStatusListener(context.mainExecutor, l)
        thermal = THERMAL.getOrElse(pm.currentThermalStatus) { "none" }
        push()
    }

    fun stop() {
        receiver?.let { runCatching { context.unregisterReceiver(it) } }
        thermalListener?.let { context.getSystemService(PowerManager::class.java).removeThermalStatusListener(it) }
        receiver = null
        sink = null
    }

    /** Recheck after the user comes back from a Fix button. */
    fun push() {
        sink?.invoke(Conditions(battery, charging, thermal, setupGaps()))
    }

    /** "Always open Locarc" is only provable: an attach that arrives with access already granted. */
    fun usbAlwaysOpenSeen() {
        prefs.edit().putBoolean("usbAlwaysOpen", true).apply()
        push()
    }

    fun confirmAutostart() {
        prefs.edit().putBoolean("autostart", true).apply()
        push()
    }

    fun setupGaps(): List<String> {
        val gaps = mutableListOf<String>()
        if (!granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) gaps += "backgroundLocation"
        if (!context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)) {
            gaps +=
                "batteryRestrictions"
        }
        if (!prefs.getBoolean("usbAlwaysOpen", false)) gaps += "usbAlwaysOpen"
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) gaps += "notifications"
        if (Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true) && !prefs.getBoolean("autostart", false)) gaps += "autostart"
        return gaps
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    private companion object {
        val THERMAL = listOf("none", "light", "moderate", "severe", "critical", "emergency", "shutdown")
    }
}

/** Fused location: high accuracy while scanning, balanced otherwise. */
class LocationFeed(
    private val context: Context,
) {
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    fun start(onFix: (PositionFix) -> Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        stop()
        val cb =
            object : LocationCallback() {
                override fun onLocationResult(r: LocationResult) {
                    r.lastLocation?.let { onFix(PositionFix(it.latitude, it.longitude, it.accuracy.toDouble(), it.time)) }
                }
            }
        callback = cb
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000).setMinUpdateIntervalMillis(5_000).build()
        client.requestLocationUpdates(request, cb, Looper.getMainLooper())
    }

    fun stop() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }
}
