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
import com.locarc.mobile.algorithms.SpectrumAnalyzer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
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

    private val TAG = "HackrfModule"
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

    private fun extractDevice(intent: Intent): UsbDevice? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }
    }

    override fun definition() = ModuleDefinition {

        Name("Hackrf")

        Events("onHackrfAttached", "onHackrfDetached")

        OnCreate {
            val ctx = appContext.reactContext ?: return@OnCreate
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    val device = extractDevice(intent)
                    if (!isHackrf(device)) return
                    val dev = device ?: return
                    when (intent.action) {
                        UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                            Log.d(TAG, "HackRF attached: ${dev.deviceName}")
                            sendEvent(
                                "onHackrfAttached",
                                mapOf(
                                    "deviceName" to dev.deviceName,
                                    "vendorId" to dev.vendorId,
                                    "productId" to dev.productId
                                )
                            )
                        }
                        UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                            Log.d(TAG, "HackRF detached: ${dev.deviceName}")
                            try { hackrf?.close() } catch (_: Exception) {}
                            hackrf = null
                            sendEvent(
                                "onHackrfDetached",
                                mapOf("deviceName" to dev.deviceName)
                            )
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
            Log.d(TAG, "USB attach/detach receiver registered")
        }

        AsyncFunction("isConnected") { promise: Promise ->
            val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject(
                "E_NO_CONTEXT", "React context unavailable", null
            )
            promise.resolve(Detect.isConnected(ctx))
        }

        AsyncFunction("getDeviceName") { promise: Promise ->
            val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject(
                "E_NO_CONTEXT", "React context unavailable", null
            )
            promise.resolve(Detect.getDeviceName(ctx))
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

        AsyncFunction("initDevice") { promise: Promise ->
            val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject(
                "E_NO_CONTEXT", "React context unavailable", null
            )

            val found = Detect.initHackrf(ctx, queueSize = 8) { result ->
                result.fold(
                    onSuccess = { device ->
                        hackrf = device
                        Log.d(TAG, "HackRF ready: ${device.usbDevice.deviceName}")
                        promise.resolve(true)
                    },
                    onFailure = { error ->
                        Log.e(TAG, "HackRF error: ${error.message}")
                        promise.reject("E_HACKRF", error.message ?: "Init failed", error as? Exception)
                    }
                )
            }

            if (!found) {
                promise.reject("E_NO_DEVICE", "No HackRF device found", null)
            }
        }

        AsyncFunction("runFullScan") { params: Map<String, Any>, algoParams: Map<String, Any>, promise: Promise ->
            val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject(
                "E_NO_CONTEXT", "React context unavailable", null
            )

            val settings = ScanSettings(
                minFrequencyHz = (params["minFrequencyHz"] as? Number)?.toLong()
                    ?: return@AsyncFunction promise.reject("E_PARAM", "minFrequencyHz required", null),
                maxFrequencyHz = (params["maxFrequencyHz"] as? Number)?.toLong()
                    ?: return@AsyncFunction promise.reject("E_PARAM", "maxFrequencyHz required", null),
                sampleRateHz = (params["sampleRateHz"] as? Number)?.toInt() ?: 10_000_000,
                lnaGainDb = (params["lnaGainDb"] as? Number)?.toInt() ?: 16,
                vgaGainDb = (params["vgaGainDb"] as? Number)?.toInt() ?: 20,
                bufferSizeKb = (params["bufferSizeKb"] as? Number)?.toInt() ?: 256,
                chunksPerStep = (params["chunksPerStep"] as? Number)?.toInt() ?: 16
            )

            val algoConfig = AlgoConfig.fromMap(algoParams)

            scope.launch {
                try {
                    if (hackrf == null) {
                        val device = suspendCoroutine { cont ->
                            val found = Detect.initHackrf(ctx, queueSize = 8) { result ->
                                result.fold(
                                    onSuccess = { cont.resume(it) },
                                    onFailure = { cont.resumeWithException(it) }
                                )
                            }
                            if (!found) {
                                cont.resumeWithException(UsbException("No HackRF device found"))
                            }
                        }
                        hackrf = device
                    }

                    val dev = hackrf ?: throw UsbException("HackRF not available")

                    dev.setBufferSize(settings.bufferSizeKb)
                    dev.setSampleRate(settings.sampleRateHz, 1)
                    dev.setBasebandFilterBandwidth(
                        Hackrf.computeBasebandFilterBandwidth(settings.sampleRateHz)
                    )
                    if (!dev.setLnaGain(settings.lnaGainDb)) {
                        throw UsbException("HackRF rejected LNA gain ${settings.lnaGainDb} dB")
                    }
                    if (!dev.setVgaGain(settings.vgaGainDb)) {
                        throw UsbException("HackRF rejected VGA gain ${settings.vgaGainDb} dB")
                    }

                    val bandwidth = settings.sampleRateHz.toLong()
                    if (bandwidth <= 0L) {
                        throw IllegalArgumentException("sampleRateHz must be positive")
                    }
                    if (settings.minFrequencyHz > settings.maxFrequencyHz) {
                        throw IllegalArgumentException("minFrequencyHz must be <= maxFrequencyHz")
                    }

                    val allMeasurements = mutableListOf<Map<String, Any>>()
                    var centerFreq = settings.minFrequencyHz
                    var stepIndex = 0

                    while (centerFreq <= settings.maxFrequencyHz) {
                        Log.d(TAG, "Sweep step ${stepIndex++}: tuning to ${centerFreq / 1_000_000.0} MHz (window ±${bandwidth / 2_000_000.0} MHz)")

                        dev.setFrequency(centerFreq)
                        Thread.sleep(40)

                        val rxQueue = dev.startRX()
                        val stepChunks = ArrayList<ByteArray>(settings.chunksPerStep)
                        try {
                            repeat(settings.chunksPerStep) {
                                val buf = rxQueue.take()
                                stepChunks.add(buf.copyOf())
                                dev.returnBufferToBufferPool(buf)
                            }
                        } finally {
                            dev.stop()
                        }

                        val iqSamples = HackrfScanner.chunksToIqSamples(stepChunks)
                        val analyzer = SpectrumAnalyzer(
                            centerFreqHz = centerFreq.toDouble(),
                            bbSampleRate = settings.sampleRateHz.toDouble(),
                            config = algoConfig
                        )
                        val measurements = analyzer.analyzeSpectrum(iqSamples)

                        for (m in measurements) {
                            allMeasurements.add(
                                mapOf("frequency" to m.frequency, "powerDbm" to m.powerDbm)
                            )
                        }

                        centerFreq += bandwidth
                    }

                    Log.d(TAG, "Sweep complete: $stepIndex windows, ${allMeasurements.size} measurements")
                    promise.resolve(allMeasurements)

                } catch (e: CancellationException) {
                    try { hackrf?.close() } catch (_: Exception) {}
                    hackrf = null
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "runFullScan failed", e)
                    try { hackrf?.close() } catch (ce: Exception) { Log.w(TAG, "Error closing HackRF", ce) }
                    hackrf = null
                    promise.reject("E_FULL_SCAN", e.message ?: "Full scan failed", e)
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