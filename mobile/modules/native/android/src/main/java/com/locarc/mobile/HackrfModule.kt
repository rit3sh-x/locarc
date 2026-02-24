package com.locarc.mobile

import android.util.Log
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

    override fun definition() = ModuleDefinition {

        Name("Hackrf")

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

        AsyncFunction("runFullScan") { params: Map<String, Any>, promise: Promise ->
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
                    dev.setLnaGain(settings.lnaGainDb)
                    dev.setVgaGain(settings.vgaGainDb)

                    val analysisCenter = (settings.minFrequencyHz + settings.maxFrequencyHz) / 2
                    dev.setFrequency(analysisCenter)
                    Thread.sleep(40)

                    val rxQueue = dev.startRX()
                    val allChunks = mutableListOf<ByteArray>()
                    repeat(settings.chunksPerStep * 2) {
                        val buf = rxQueue.take()
                        allChunks.add(buf.copyOf())
                        dev.returnBufferToBufferPool(buf)
                    }
                    dev.stop()

                    val iqSamples = HackrfScanner.chunksToIqSamples(allChunks)
                    val analyzer = SpectrumAnalyzer(
                        centerFreqHz = analysisCenter.toDouble(),
                        bbSampleRate = settings.sampleRateHz.toDouble()
                    )
                    val measurements = analyzer.analyzeSpectrum(iqSamples)

                    val serialised = measurements.map { m ->
                        mapOf("frequency" to m.frequency, "powerDbm" to m.powerDbm)
                    }

                    promise.resolve(serialised)

                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "runFullScan failed", e)
                    promise.reject("E_FULL_SCAN", e.message ?: "Full scan failed", e)
                } finally {
                    try {
                        hackrf?.close()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error closing HackRF", e)
                    }
                    hackrf = null
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
            hackrf?.close()
            scope.cancel()
        }
    }
}