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
import com.locarc.mobile.algorithms.AlgoConfig
import com.locarc.mobile.algorithms.Complex
import com.locarc.mobile.algorithms.SpectrumAnalyzer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class HackrfModule : Module() {

    companion object {
        private const val TAG = "HackrfModule"

        private const val HACKRF_MIN_FREQ_HZ = 1_000_000L
        private const val HACKRF_MAX_FREQ_HZ = 6_000_000_000L

        private const val MIN_BUFFER_SIZE_KB = 64
        private const val MAX_BUFFER_SIZE_KB = 512
        private const val MAX_CHUNKS_PER_STEP = 32
        private const val MAX_SWEEP_WINDOWS = 200

        private const val MAX_PER_STEP_BYTES = 2L * 1024L * 1024L

        private const val TUNE_SETTLE_MS = 40L

        private const val EVENT_ATTACHED = "onHackrfAttached"
        private const val EVENT_DETACHED = "onHackrfDetached"
    }

    private class ScanParamException(val code: String, message: String) : Exception(message)

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var hackrf: Hackrf? = null
    private var usbReceiver: BroadcastReceiver? = null

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
        val minFrequencyHz = (params["minFrequencyHz"] as? Number)?.toLong()
            ?: throw ScanParamException("E_PARAM", "minFrequencyHz required")
        val maxFrequencyHz = (params["maxFrequencyHz"] as? Number)?.toLong()
            ?: throw ScanParamException("E_PARAM", "maxFrequencyHz required")
        val sampleRateHz = (params["sampleRateHz"] as? Number)?.toInt() ?: 10_000_000
        val lnaGainDb = (params["lnaGainDb"] as? Number)?.toInt() ?: 16
        val vgaGainDb = (params["vgaGainDb"] as? Number)?.toInt() ?: 20
        val requestedBufferKb = (params["bufferSizeKb"] as? Number)?.toInt() ?: 256
        val requestedChunks = (params["chunksPerStep"] as? Number)?.toInt() ?: 16

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
        val bytesPerChunk = bufferKb.toLong() * 1024L
        val maxChunksByMemory = (MAX_PER_STEP_BYTES / bytesPerChunk).toInt().coerceAtLeast(1)
        val chunks = requestedChunks
            .coerceIn(1, MAX_CHUNKS_PER_STEP)
            .coerceAtMost(maxChunksByMemory)

        if (bufferKb != requestedBufferKb) {
            Log.w(TAG, "bufferSizeKb $requestedBufferKb → $bufferKb (capped)")
        }
        if (chunks != requestedChunks) {
            Log.w(TAG, "chunksPerStep $requestedChunks → $chunks (memory cap)")
        }

        val windowCount =
            ((maxFrequencyHz - minFrequencyHz) / sampleRateHz.toLong()) + 1
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
            bufferSizeKb = bufferKb,
            chunksPerStep = chunks
        )
    }

    private suspend fun ensureDevice(ctx: Context): Hackrf {
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
        return device
    }

    private fun configureDevice(dev: Hackrf, settings: ScanSettings) {
        dev.setBufferSize(settings.bufferSizeKb)
        dev.setSampleRate(settings.sampleRateHz, 1)
        val bbFilter = Hackrf.computeBasebandFilterBandwidth(settings.sampleRateHz)
        dev.setBasebandFilterBandwidth(bbFilter)
        if (!dev.setLnaGain(settings.lnaGainDb)) {
            throw UsbException("HackRF rejected LNA gain ${settings.lnaGainDb} dB")
        }
        if (!dev.setVgaGain(settings.vgaGainDb)) {
            throw UsbException("HackRF rejected VGA gain ${settings.vgaGainDb} dB")
        }
        Log.d(
            TAG,
            "configured: sr=${settings.sampleRateHz / 1e6} MHz bb=${bbFilter / 1e6} MHz " +
                    "lna=${settings.lnaGainDb} vga=${settings.vgaGainDb}"
        )
    }

    private fun captureStep(dev: Hackrf, chunksPerStep: Int): ArrayList<ByteArray> {
        val rxQueue = dev.startRX()
        val chunks = ArrayList<ByteArray>(chunksPerStep)
        try {
            repeat(chunksPerStep) {
                val buf = rxQueue.take()
                chunks.add(buf.copyOf())
                dev.returnBufferToBufferPool(buf)
            }
        } finally {
            dev.stop()
        }
        return chunks
    }

    private fun analyzeStep(
        centerFreqHz: Long,
        sampleRateHz: Int,
        iqSamples: Array<Complex>,
        algoConfig: AlgoConfig
    ): List<SpectrumAnalyzer.PowerMeasurement> {
        val analyzer = SpectrumAnalyzer(
            centerFreqHz = centerFreqHz.toDouble(),
            bbSampleRate = sampleRateHz.toDouble(),
            config = algoConfig
        )
        return analyzer.analyzeSpectrum(iqSamples)
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

            val found = Detect.initHackrf(ctx, queueSize = 8) { result ->
                result.fold(
                    onSuccess = {
                        hackrf = it
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
            val algoConfig = AlgoConfig.fromMap(algoParams)

            val windowCount =
                ((settings.maxFrequencyHz - settings.minFrequencyHz) / settings.sampleRateHz.toLong()) + 1
            val perStepMb = (settings.bufferSizeKb.toLong() * 1024L * settings.chunksPerStep) / (1024 * 1024)

            Log.i(
                TAG,
                "runFullScan START: ${settings.minFrequencyHz / 1e6}..${settings.maxFrequencyHz / 1e6} MHz " +
                        "sr=${settings.sampleRateHz / 1e6} MHz lna=${settings.lnaGainDb} vga=${settings.vgaGainDb} " +
                        "bufKB=${settings.bufferSizeKb} chunks=${settings.chunksPerStep} " +
                        "windows=$windowCount perStep=${perStepMb}MB"
            )
            logMemory("runFullScan: start")

            val scanStartNs = System.nanoTime()

            scope.launch {
                var phase = "init"
                try {
                    phase = "device-init"
                    val dev = ensureDevice(ctx)

                    phase = "configure"
                    configureDevice(dev, settings)

                    val bandwidth = settings.sampleRateHz.toLong()
                    val allMeasurements = mutableListOf<Map<String, Any>>()
                    var centerFreq = settings.minFrequencyHz
                    var stepIndex = 0

                    while (centerFreq <= settings.maxFrequencyHz) {
                        val step = stepIndex++
                        val stepStartNs = System.nanoTime()
                        Log.i(TAG, "sweep[$step]: tune to ${centerFreq / 1e6} MHz")

                        phase = "step[$step]/tune"
                        dev.setFrequency(centerFreq)
                        Thread.sleep(TUNE_SETTLE_MS)

                        phase = "step[$step]/rx"
                        val rawChunks = captureStep(dev, settings.chunksPerStep)
                        val rawBytes = rawChunks.sumOf { it.size }
                        Log.d(TAG, "sweep[$step]: captured ${rawChunks.size} chunks, $rawBytes bytes")

                        phase = "step[$step]/iq-convert"
                        var iqSamples: Array<Complex>? =
                            HackrfScanner.chunksToIqSamples(rawChunks)
                        rawChunks.clear()
                        logMemory("sweep[$step]: post-iq (${iqSamples!!.size} samples)")

                        phase = "step[$step]/analyze"
                        val analyzeStart = System.nanoTime()
                        val measurements = analyzeStep(
                            centerFreqHz = centerFreq,
                            sampleRateHz = settings.sampleRateHz,
                            iqSamples = iqSamples!!,
                            algoConfig = algoConfig
                        )
                        iqSamples = null

                        Log.i(
                            TAG,
                            "sweep[$step]: ${measurements.size} measurements in " +
                                    "${(System.nanoTime() - analyzeStart) / 1_000_000} ms"
                        )

                        phase = "step[$step]/accumulate"
                        for (m in measurements) {
                            allMeasurements.add(
                                mapOf("frequency" to m.frequency, "powerDbm" to m.powerDbm)
                            )
                        }

                        Log.d(
                            TAG,
                            "sweep[$step]: complete in ${(System.nanoTime() - stepStartNs) / 1_000_000} ms"
                        )

                        centerFreq += bandwidth
                    }

                    val totalMs = (System.nanoTime() - scanStartNs) / 1_000_000
                    Log.i(
                        TAG,
                        "runFullScan DONE: $stepIndex windows, ${allMeasurements.size} measurements, ${totalMs} ms"
                    )
                    logMemory("runFullScan: done")
                    promise.resolve(allMeasurements)

                } catch (e: CancellationException) {
                    Log.w(TAG, "runFullScan CANCELLED during phase=$phase")
                    try { hackrf?.close() } catch (_: Exception) {}
                    hackrf = null
                    throw e
                } catch (e: OutOfMemoryError) {
                    Log.e(TAG, "runFullScan OOM during phase=$phase", e)
                    logMemory("runFullScan: at OOM")
                    try { hackrf?.close() } catch (_: Exception) {}
                    hackrf = null
                    promise.reject("E_OOM", "Out of memory during $phase: ${e.message}", null)
                } catch (e: Exception) {
                    Log.e(TAG, "runFullScan FAILED during phase=$phase", e)
                    logMemory("runFullScan: at failure")
                    try { hackrf?.close() } catch (_: Exception) {}
                    hackrf = null
                    promise.reject("E_FULL_SCAN", "[$phase] ${e.message ?: "Full scan failed"}", e)
                }
            }
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
