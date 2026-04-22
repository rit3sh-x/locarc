package com.locarc.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class HackrfModule : Module() {

    companion object {
        private const val TAG = "HackrfModule"

        private const val HACKRF_MIN_FREQ_HZ = 1_000_000L
        private const val HACKRF_MAX_FREQ_HZ = 6_000_000_000L

        private const val MIN_BUFFER_SIZE_KB = 128
        private const val MAX_BUFFER_SIZE_KB = 2048
        private const val MAX_SWEEP_WINDOWS = 400

        private const val COLD_OPEN_SETTLE_MS = 250L
        private const val USB_RESET_QUIESCE_MS = 500L
        private const val PERIODIC_RESET_EVERY_N_SCANS = 20

        private const val EVENT_ATTACHED = "onHackrfAttached"
        private const val EVENT_DETACHED = "onHackrfDetached"

        const val ERR_HACKRF_DISCONNECTED = "HACKRF_DISCONNECTED"
    }

    private class ScanParamException(val code: String, message: String) : Exception(message)

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var hackrf: Hackrf? = null
    private var usbReceiver: BroadcastReceiver? = null
    private var scanJob: Job? = null
    @Volatile
    private var scanCancelledByDetach: Boolean = false
    private var scanCount: Int = 0
    private var lifetimeTotalResets: Int = 0
    private var forceFullResetOnNextInit: Boolean = false

    private fun isHackrf(device: UsbDevice?): Boolean {
        if (device == null) return false
        return device.vendorId == Detect.VENDOR_ID &&
                device.productId in setOf(
                    Detect.PRODUCT_ID_HACKRF_ONE,
                    Detect.PRODUCT_ID_RAD1O,
                    Detect.PRODUCT_ID_JAWBREAKER
                )
    }

    private fun extractDevice(intent: Intent): UsbDevice? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }

    private fun logMemory(label: String) {
        val rt = Runtime.getRuntime()
        val usedMb = (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024)
        val maxMb = rt.maxMemory() / (1024 * 1024)
        Log.d(TAG, "$label: heap ${usedMb}/${maxMb} MB")
    }

    private fun parseScanSettings(params: Map<String, Any>): ScanSettings {
        fun reqLong(key: String): Long = (params[key] as? Number)?.toLong()
            ?: throw ScanParamException("E_PARAM", "$key is required")
        fun reqInt(key: String): Int = (params[key] as? Number)?.toInt()
            ?: throw ScanParamException("E_PARAM", "$key is required")

        val minFrequencyHz = reqLong("minFrequencyHz")
        val maxFrequencyHz = reqLong("maxFrequencyHz")
        val sampleRateHz = reqInt("sampleRateHz")
        val lnaGainDb = reqInt("lnaGainDb")
        val vgaGainDb = reqInt("vgaGainDb")
        val requestedBufferKb = reqInt("bufferSizeKb")

        if (sampleRateHz <= 0) {
            throw ScanParamException("E_PARAM", "sampleRateHz must be positive")
        }
        if (minFrequencyHz < HACKRF_MIN_FREQ_HZ) {
            throw ScanParamException(
                "E_PARAM",
                "minFrequencyHz must be ≥ ${HACKRF_MIN_FREQ_HZ / 1_000_000} MHz"
            )
        }
        if (maxFrequencyHz > HACKRF_MAX_FREQ_HZ) {
            throw ScanParamException(
                "E_PARAM",
                "maxFrequencyHz must be ≤ ${HACKRF_MAX_FREQ_HZ / 1_000_000_000} GHz"
            )
        }
        if (minFrequencyHz > maxFrequencyHz) {
            throw ScanParamException("E_PARAM", "minFrequencyHz must be ≤ maxFrequencyHz")
        }

        val bufferKb = requestedBufferKb.coerceIn(MIN_BUFFER_SIZE_KB, MAX_BUFFER_SIZE_KB)
        if (bufferKb != requestedBufferKb) {
            Log.w(TAG, "bufferSizeKb $requestedBufferKb → $bufferKb (capped)")
        }

        val sweepStepHz = (sampleRateHz.toLong() / 2L).coerceAtLeast(1L)
        val windowCount =
            ((maxFrequencyHz - minFrequencyHz) / sweepStepHz) + 1
        if (windowCount > MAX_SWEEP_WINDOWS) {
            throw ScanParamException(
                "E_SWEEP_TOO_LARGE",
                "Sweep needs $windowCount windows (max $MAX_SWEEP_WINDOWS). " +
                        "Narrow the frequency range or increase sampleRateHz."
            )
        }

        return ScanSettings(
            minFrequencyHz = minFrequencyHz,
            maxFrequencyHz = maxFrequencyHz,
            sampleRateHz = sampleRateHz,
            lnaGainDb = lnaGainDb,
            vgaGainDb = vgaGainDb,
            bufferSizeKb = bufferKb
        )
    }

    private suspend fun ensureDevice(ctx: Context): Hackrf {
        if (forceFullResetOnNextInit && hackrf != null) {
            Log.i(TAG, "periodic full reset after $scanCount scans")
            try { hackrf?.close() } catch (_: Exception) {}
            hackrf = null
            forceFullResetOnNextInit = false
            try { delay(USB_RESET_QUIESCE_MS) } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
        hackrf?.let { return it }
        Log.d(TAG, "ensureDevice: requesting Detect.initHackrf")
        val device = suspendCoroutine<Hackrf> { cont ->
            val found = Detect.initHackrf(ctx, queueSize = 8) { result ->
                result.fold(
                    onSuccess = { cont.resume(it) },
                    onFailure = { cont.resumeWithException(it) }
                )
            }
            if (!found) cont.resumeWithException(UsbException("No HackRF device found"))
        }
        hackrf = device
        try { Thread.sleep(COLD_OPEN_SETTLE_MS) } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        return device
    }

    override fun definition() = ModuleDefinition {

        Name("Hackrf")
        Events(EVENT_ATTACHED, EVENT_DETACHED)

        OnCreate {
            val ctx = appContext.reactContext ?: return@OnCreate
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    val dev = extractDevice(intent) ?: return
                    if (!isHackrf(dev)) return
                    when (intent.action) {
                        UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                            Log.d(TAG, "USB attached: ${dev.deviceName}")
                            sendEvent(
                                EVENT_ATTACHED,
                                mapOf(
                                    "deviceName" to dev.deviceName,
                                    "vendorId" to dev.vendorId,
                                    "productId" to dev.productId
                                )
                            )
                        }
                        UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                            Log.d(TAG, "USB detached: ${dev.deviceName}")
                            val job = scanJob
                            if (job != null && job.isActive) {
                                scanCancelledByDetach = true
                                HackrfNative.nativeCancelScan()
                            }
                            try { hackrf?.close() } catch (_: Exception) {}
                            hackrf = null
                            sendEvent(EVENT_DETACHED, mapOf("deviceName" to dev.deviceName))
                        }
                    }
                }
            }
            val filter = IntentFilter().apply {
                addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
                addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            }
            ContextCompat.registerReceiver(
                ctx, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED
            )
            usbReceiver = receiver
            Log.d(TAG, "USB receiver registered")
        }

        AsyncFunction("ping") { promise: Promise ->
            promise.resolve(
                mapOf(
                    "status" to "ok",
                    "module" to "HackrfModule",
                    "version" to 1
                )
            )
        }

        AsyncFunction("isConnected") { promise: Promise ->
            val ctx = appContext.reactContext
                ?: return@AsyncFunction promise.reject("E_NO_CONTEXT", "React context unavailable", null)
            promise.resolve(Detect.isConnected(ctx))
        }

        AsyncFunction("getDeviceName") { promise: Promise ->
            val ctx = appContext.reactContext
                ?: return@AsyncFunction promise.reject("E_NO_CONTEXT", "React context unavailable", null)
            promise.resolve(Detect.getDeviceName(ctx))
        }

        AsyncFunction("initDevice") { promise: Promise ->
            val ctx = appContext.reactContext
                ?: return@AsyncFunction promise.reject("E_NO_CONTEXT", "React context unavailable", null)

            if (forceFullResetOnNextInit && hackrf != null) {
                Log.i(TAG, "periodic full reset after $scanCount scans")
                try { hackrf?.close() } catch (_: Exception) {}
                hackrf = null
                forceFullResetOnNextInit = false
                try { Thread.sleep(USB_RESET_QUIESCE_MS) } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }

            hackrf?.let {
                Log.d(TAG, "initDevice: reusing cached HackRF handle ${it.usbDevice.deviceName}")
                return@AsyncFunction promise.resolve(true)
            }

            val found = Detect.initHackrf(ctx, queueSize = 8) { result ->
                result.fold(
                    onSuccess = {
                        hackrf = it
                        try { Thread.sleep(COLD_OPEN_SETTLE_MS) } catch (_: InterruptedException) {
                            Thread.currentThread().interrupt()
                        }
                        Log.d(TAG, "HackRF ready: ${it.usbDevice.deviceName}")
                        promise.resolve(true)
                    },
                    onFailure = { error ->
                        Log.e(TAG, "HackRF init failed: ${error.message}")
                        promise.reject("E_HACKRF", error.message ?: "Init failed", error as? Exception)
                    }
                )
            }
            if (!found) {
                promise.reject("E_NO_DEVICE", "No HackRF device found", null)
            }
        }

        AsyncFunction("runFullScan") {
                params: Map<String, Any>,
                algoParams: Map<String, Any>,
                promise: Promise ->

            val ctx = appContext.reactContext
                ?: return@AsyncFunction promise.reject("E_NO_CONTEXT", "React context unavailable", null)

            val settings = try {
                parseScanSettings(params)
            } catch (e: ScanParamException) {
                return@AsyncFunction promise.reject(e.code, e.message ?: "Invalid params", null)
            }
            val algoPacked = AlgoParams.fromMap(algoParams)
            algoPacked.doubles[16] = settings.minFrequencyHz.toDouble()
            algoPacked.doubles[17] = settings.maxFrequencyHz.toDouble()

            val sweepStepHz = (settings.sampleRateHz.toLong() / 2L).coerceAtLeast(1L)
            val windowCount =
                ((settings.maxFrequencyHz - settings.minFrequencyHz) / sweepStepHz) + 1
            val perStepBytes = settings.bufferSizeKb.toLong() * 1024L
            val perStepSamples = perStepBytes / 2L

            Log.i(
                TAG,
                "runFullScan START: ${settings.minFrequencyHz / 1e6}..${settings.maxFrequencyHz / 1e6} MHz " +
                        "sr=${settings.sampleRateHz / 1e6} MHz lna=${settings.lnaGainDb} vga=${settings.vgaGainDb} " +
                        "bufKB=${settings.bufferSizeKb} " +
                        "windows=$windowCount stepHz=${sweepStepHz} " +
                        "perStep=${perStepBytes}B (~${perStepSamples} IQ samples)"
            )
            logMemory("runFullScan: start")

            val scanStartNs = System.nanoTime()

            scanCancelledByDetach = false
            ScanForegroundService.start(ctx)
            val job = scope.launch {
                try {
                    val dev = ensureDevice(ctx)

                    val flat = HackrfNative.nativeRunFullScan(
                        handle = dev.handle,
                        minFreqHz = settings.minFrequencyHz,
                        maxFreqHz = settings.maxFrequencyHz,
                        sampleRateHz = settings.sampleRateHz,
                        lnaGainDb = settings.lnaGainDb,
                        vgaGainDb = settings.vgaGainDb,
                        perStepBytes = perStepBytes.toInt(),
                        algoDoubles = algoPacked.doubles,
                        algoInts = algoPacked.ints
                    )

                    if (scanCancelledByDetach) {
                        promise.reject(ERR_HACKRF_DISCONNECTED, "HackRF unplugged mid-scan", null)
                        return@launch
                    }

                    val out = ArrayList<Map<String, Any>>(flat.size / 2)
                    var i = 0
                    while (i + 1 < flat.size) {
                        out.add(mapOf("frequency" to flat[i], "powerDbm" to flat[i + 1]))
                        i += 2
                    }
                    val totalMs = (System.nanoTime() - scanStartNs) / 1_000_000
                    Log.i(TAG, "runFullScan DONE: ${out.size} measurements, ${totalMs} ms")
                    logMemory("runFullScan: done")
                    promise.resolve(out)
                } catch (e: CancellationException) {
                    HackrfNative.nativeCancelScan()
                    if (scanCancelledByDetach) {
                        promise.reject(ERR_HACKRF_DISCONNECTED, "HackRF unplugged mid-scan", null)
                    } else {
                        promise.reject("E_CANCELLED", "Scan cancelled: ${e.message}", e)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "runFullScan FAILED", e)
                    if (scanCancelledByDetach) {
                        promise.reject(ERR_HACKRF_DISCONNECTED, "HackRF unplugged mid-scan", null)
                    } else {
                        promise.reject("E_FULL_SCAN", e.message ?: "Full scan failed", e)
                    }
                } finally {
                    scanJob = null
                    if (HackrfNative.nativeConsumeResetFlag()) {
                        Log.w(TAG, "native scan issued HackRF reset — recycling wrapper")
                        try { hackrf?.close() } catch (_: Exception) {}
                        hackrf = null
                        forceFullResetOnNextInit = true
                        lifetimeTotalResets += 1
                    }
                    try { ScanForegroundService.stop(ctx) } catch (_: Exception) {}
                }
            }
            scanJob = job
        }

        AsyncFunction("closeDevice") { promise: Promise ->
            try {
                hackrf?.close()
                hackrf = null
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_CLOSE", e.message ?: "Failed to close", e)
            }
        }

        AsyncFunction("resetDevice") { promise: Promise ->
            try {
                val job = scanJob
                if (job != null && job.isActive) {
                    HackrfNative.nativeCancelScan()
                }
                val dev = hackrf
                if (dev == null) {
                    Log.i(TAG, "resetDevice: no cached handle — nothing to reset")
                    promise.resolve(0)
                    return@AsyncFunction
                }
                val rc = dev.reset()
                hackrf = null
                forceFullResetOnNextInit = true
                lifetimeTotalResets += 1
                HackrfNative.nativeConsumeResetFlag()
                Log.w(TAG, "resetDevice: reset issued rc=$rc (lifetime resets=$lifetimeTotalResets)")
                promise.resolve(rc)
            } catch (e: Exception) {
                Log.e(TAG, "resetDevice failed", e)
                promise.reject("E_RESET", e.message ?: "reset failed", e)
            }
        }

        OnDestroy {
            val ctx = appContext.reactContext
            val receiver = usbReceiver
            if (ctx != null && receiver != null) {
                try {
                    ctx.unregisterReceiver(receiver)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to unregister USB receiver", e)
                }
            }
            usbReceiver = null
            try { hackrf?.close() } catch (_: Exception) {}
            hackrf = null
            scope.cancel()
        }
    }
}
