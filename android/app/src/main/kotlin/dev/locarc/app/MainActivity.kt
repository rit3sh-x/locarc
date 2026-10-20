package dev.locarc.app

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import dev.locarc.core.ConvexCallException
import dev.locarc.core.ReceiverState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max

private val Teal = Color(0xFF0B7A75)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleUsb(intent)
        ScanService.start(this)
        setContent {
            val dark = isSystemInDarkTheme()
            MaterialTheme(colorScheme = if (dark) darkColorScheme(primary = Teal) else lightColorScheme(primary = Teal)) {
                App()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleUsb(intent)
    }

    override fun onResume() {
        super.onResume()
        graph.conditions.push()
    }

    /** A HackRF attach that arrives with access already granted proves "Always open Locarc". */
    private fun handleUsb(intent: Intent?) {
        if (intent?.action != UsbManager.ACTION_USB_DEVICE_ATTACHED) return
        val usb = getSystemService(UsbManager::class.java)
        val device = usb.deviceList.values.firstOrNull { it.vendorId == UsbHackRf.VID && it.productId == UsbHackRf.PID } ?: return
        if (usb.hasPermission(device)) graph.conditions.usbAlwaysOpenSeen()
        graph.engine.value?.onAttached()
        ScanService.start(this)
    }
}

@Composable
private fun App() {
    val context = LocalContext.current
    val engine by context.graph.engine.collectAsState()
    var setupDone by remember { mutableStateOf(false) }
    val e = engine
    if (e == null) {
        PairingScreen()
        return
    }
    val state by e.state.collectAsState()
    if (!setupDone &&
        context.graph.conditions
            .setupGaps()
            .isNotEmpty() &&
        state.lastSyncAt == null
    ) {
        SetupScreen(onDone = { setupDone = true })
        return
    }
    var tab by remember { mutableIntStateOf(0) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Text("●") }, label = { Text("Status") })
                NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Text("◎") }, label = { Text("Map") })
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            if (tab == 0) StatusScreen(state) else MapScreen(state)
        }
    }
}

// Pairing

@Composable
private fun PairingScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var deployment by remember { mutableStateOf(BuildConfig.DEPLOYMENT_URL) }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun pair(
        url: String,
        c: String,
    ) {
        busy = true
        error = null
        scope.launch {
            try {
                context.graph.pair(url, c)
                ScanService.start(context)
            } catch (e: ConvexCallException) {
                error =
                    if (e.code == "CODE_INVALID") "That code is wrong, used or expired. Generate a new one on the website." else e.message
            } catch (e: Exception) {
                error = "Couldn't reach Locarc: ${e.message}"
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Pair this Receiver", style = MaterialTheme.typography.headlineSmall)
        Text("On the website: Receivers → Pair Receiver. Scan its QR, or type its code.")
        Button(
            enabled = !busy,
            onClick = {
                val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                GmsBarcodeScanning.getClient(context, options).startScan().addOnSuccessListener { b ->
                    val uri = Uri.parse(b.rawValue ?: "")
                    val url = uri.getQueryParameter("deployment")
                    val c = uri.getQueryParameter("code")
                    if (uri.scheme == "locarc" && url != null && c != null) pair(url, c) else error = "That isn't a Locarc pairing QR."
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Scan QR") }
        HorizontalDivider()
        if (BuildConfig.DEPLOYMENT_URL.isEmpty()) {
            OutlinedTextField(deployment, {
                deployment = it.trim()
            }, label = { Text("Deployment URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        OutlinedTextField(
            code,
            { code = it.uppercase().filter { ch -> ch.isLetterOrDigit() || ch == '-' }.take(9) },
            label = { Text("Code (XXXX-XXXX)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(enabled = !busy && code.length >= 8 && deployment.isNotEmpty(), onClick = {
            pair(deployment, code)
        }, modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "Pairing…" else "Pair")
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

// Setup checklist: warns, never blocks

@Composable
private fun SetupScreen(onDone: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Set up this phone", style = MaterialTheme.typography.headlineSmall)
        Text("Scanning already runs. These keep it running unattended; fix what you can.")
        SetupGaps()
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Continue") }
    }
}

@Composable
private fun SetupGaps() {
    val context = LocalContext.current
    var gaps by remember { mutableStateOf(context.graph.conditions.setupGaps()) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            gaps =
                context.graph.conditions.setupGaps()
        }
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            gaps =
                context.graph.conditions.setupGaps()
        }
    LaunchedEffect(Unit) {
        while (true) {
            delay(2_000)
            gaps = context.graph.conditions.setupGaps()
            context.graph.conditions.push()
        }
    }
    val items =
        listOf(
            Triple("backgroundLocation", "Location: \"Allow all the time\"", "Restarts scanning, with GPS, after a reboot."),
            Triple("batteryRestrictions", "No battery restrictions", "Android won't stop the scanner overnight."),
            Triple(
                "usbAlwaysOpen",
                "\"Always open Locarc\" for the HackRF",
                "Plug the HackRF in and tick \"Always open Locarc\": replugs then need no one.",
            ),
            Triple("notifications", "Notifications", "The ongoing notification shows state and problems."),
            Triple("autostart", "Autostart (Xiaomi)", "MIUI blocks restarts unless Autostart is on for Locarc."),
        )
    for ((id, title, why) in items) {
        val missing = id in gaps
        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text((if (missing) "○ " else "✓ ") + title, fontWeight = FontWeight.Medium)
                    if (missing) Text(why, style = MaterialTheme.typography.bodySmall)
                }
                if (missing && id != "usbAlwaysOpen") {
                    TextButton(onClick = {
                        when (id) {
                            "backgroundLocation" ->
                                if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                                    android.content.pm.PackageManager.PERMISSION_GRANTED
                                ) {
                                    permissions.launch(
                                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                                    )
                                } else {
                                    context.startActivity(
                                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
                                    )
                                }
                            "batteryRestrictions" ->
                                context.startActivity(
                                    Intent(
                                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                        Uri.parse("package:${context.packageName}"),
                                    ),
                                )
                            "notifications" ->
                                if (Build.VERSION.SDK_INT >= 33) {
                                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                } else {
                                    context.startActivity(
                                        Intent(
                                            Settings.ACTION_APP_NOTIFICATION_SETTINGS,
                                        ).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
                                    )
                                }
                            "autostart" -> {
                                runCatching {
                                    context.startActivity(
                                        Intent().setComponent(
                                            ComponentName(
                                                "com.miui.securitycenter",
                                                "com.miui.permcenter.autostart.AutoStartManagementActivity",
                                            ),
                                        ),
                                    )
                                }
                                context.graph.conditions.confirmAutostart()
                            }
                        }
                    }) { Text("Fix") }
                }
            }
        }
    }
}

// Status: is this Receiver healthy, and if not, why

@Composable
private fun StatusScreen(s: ReceiverState) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(context.graph.receiverName ?: "Receiver", style = MaterialTheme.typography.titleMedium)
        Text(
            s.status,
            style = MaterialTheme.typography.headlineMedium,
            color =
                if (s.status == "Scanning" ||
                    s.status == "Idle"
                ) {
                    Teal
                } else {
                    MaterialTheme.colorScheme.error
                },
        )
        s.reason?.let { Text(it) }
        HorizontalDivider()
        val run = s.run
        Fact("Run", run?.let { "Run ${it.number} · every ${it.periodMs / 1000} s" } ?: "not scanning")
        s.nextBoundary?.let { Fact("Scan", "${(s.scanK ?: 0) + 1} · next in ${countdown(max(0, it + (run?.periodMs ?: 0) - now))}") }
        Fact("HackRF", s.hackrf + (s.device?.let { " · firmware ${it.firmware}" } ?: ""))
        Fact("GPS", if (s.pinned) "pinned" else s.position?.let { "±${it.accuracyM.toInt()} m" } ?: "no fix")
        Fact("Uploads waiting", s.outboxDepth.toString())
        Fact("Battery", "${(s.conditions.battery * 100).toInt()}%" + if (s.conditions.charging) " · charging" else "")
        Fact("Thermal", s.conditions.thermal)
        Fact("Window", if (s.window.mode == "full") "full" else "short · ${s.window.reason}")
        Fact("Clock", if (s.clockUncertaintyMs >= 3_600_000) "not synced yet" else "±${s.clockUncertaintyMs.toInt()} ms")
        Fact("App", BuildConfig.VERSION_NAME)
        s.lastError?.let { Fact("Last error", it) }
        if (s.conditions.setupGaps.isNotEmpty()) {
            HorizontalDivider()
            Text("Setup incomplete", fontWeight = FontWeight.Medium)
            SetupGaps()
        }
        if (s.lastEmitters.isNotEmpty()) {
            HorizontalDivider()
            Text("Strongest Emitters heard (${s.lastPasses} passes)", fontWeight = FontWeight.Medium)
            for (e in s.lastEmitters) {
                Row {
                    Text(
                        "%.4f MHz".format(e.strongestCh * s.rasterHz / 1e6),
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        (e.fixPowerDbm?.let { "%.1f dBm".format(it) } ?: "later") +
                            " · ${if (s.lastPasses > 0) 100 * e.passesOn / s.lastPasses else 0}%",
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
        Spacer(Modifier.padding(8.dp))
    }
}

@Composable
private fun Fact(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontFamily = FontFamily.Monospace)
    }
}

private fun countdown(ms: Long): String {
    val s = ms / 1000
    return "%d:%02d".format(s / 60, s % 60)
}
