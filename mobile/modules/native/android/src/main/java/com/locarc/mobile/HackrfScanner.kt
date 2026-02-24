package com.locarc.mobile

import android.util.Log
import com.locarc.mobile.algorithms.Complex
import com.locarc.mobile.algorithms.DspUtils
import com.locarc.mobile.algorithms.FftEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.ArrayBlockingQueue
import kotlin.math.log10

data class ScanSettings(
    val minFrequencyHz: Long,
    val maxFrequencyHz: Long,
    val sampleRateHz: Int = 10_000_000,
    val lnaGainDb: Int = 16,
    val vgaGainDb: Int = 20,
    val bufferSizeKb: Int = 256,
    val chunksPerStep: Int = 16
)

data class FrequencyBin(
    val frequencyHz: Double,
    val powerDbm: Double
)

data class ScanResult(
    val centerFrequencyHz: Long,
    val bins: List<FrequencyBin>
)

object HackrfScanner {

    private const val TAG = "HackrfScanner"

    suspend fun scan(
        hackrf: Hackrf,
        settings: ScanSettings
    ): List<ScanResult> = withContext(Dispatchers.IO) {

        val results = mutableListOf<ScanResult>()
        val bandwidth = settings.sampleRateHz.toLong()

        hackrf.setBufferSize(settings.bufferSizeKb)
        hackrf.setSampleRate(settings.sampleRateHz, 1)
        hackrf.setLnaGain(settings.lnaGainDb)
        hackrf.setVgaGain(settings.vgaGainDb)

        var centerFreq = settings.minFrequencyHz

        while (centerFreq <= settings.maxFrequencyHz) {
            Log.d(TAG, "Tuning to ${centerFreq / 1_000_000.0} MHz")
            hackrf.setFrequency(centerFreq)
            Thread.sleep(40)

            val rxQueue: ArrayBlockingQueue<ByteArray> = hackrf.startRX()
            val chunks = ArrayList<ByteArray>(settings.chunksPerStep)

            repeat(settings.chunksPerStep) {
                val buf = rxQueue.take()
                chunks.add(buf.copyOf())
                hackrf.returnBufferToBufferPool(buf)
            }

            hackrf.stop()

            val bins = welchPsd(chunks, settings.sampleRateHz, centerFreq)
            results.add(ScanResult(centerFrequencyHz = centerFreq, bins = bins))

            centerFreq += bandwidth
        }

        Log.d(TAG, "Scan complete. ${results.size} steps.")
        results
    }

    fun chunksToIqSamples(chunks: List<ByteArray>): Array<Complex> {
        val totalSamples = chunks.sumOf { it.size / 2 }
        val samples = Array(totalSamples) { Complex.ZERO }
        var idx = 0
        for (chunk in chunks) {
            val samplesInChunk = chunk.size / 2
            for (n in 0 until samplesInChunk) {
                val i = chunk[n * 2].toDouble() / 128.0
                val q = chunk[n * 2 + 1].toDouble() / 128.0
                samples[idx++] = Complex(i, q)
            }
        }
        return samples
    }

    private fun welchPsd(
        chunks: List<ByteArray>,
        sampleRateHz: Int,
        centerFrequencyHz: Long
    ): List<FrequencyBin> {
        if (chunks.isEmpty()) return emptyList()

        val samplesPerChunk = chunks[0].size / 2
        if (samplesPerChunk == 0) return emptyList()

        val hannWindow = DspUtils.hannWindow(samplesPerChunk)
        val fftSize = FftEngine.nextPowerOf2(samplesPerChunk)

        val powerAccum = DoubleArray(fftSize)

        for (chunk in chunks) {
            val td = Array(samplesPerChunk) { n ->
                val i = chunk[n * 2].toDouble() / 128.0
                val q = chunk[n * 2 + 1].toDouble() / 128.0
                Complex(i * hannWindow[n], q * hannWindow[n])
            }

            val fftResult = FftEngine.fftShifted(td, fftSize)

            for (k in 0 until fftSize) {
                powerAccum[k] += fftResult[k].absSq()
            }
        }

        val scale = chunks.size.toDouble() * samplesPerChunk * samplesPerChunk
        val bins = ArrayList<FrequencyBin>(fftSize)

        for (k in 0 until fftSize) {
            val power = powerAccum[k] / scale
            val dBm = if (power > 0.0) 10.0 * log10(power) + 30.0 else -120.0
            val freqOffset = (k.toDouble() / fftSize - 0.5) * sampleRateHz
            val absoluteFreqHz = centerFrequencyHz + freqOffset

            bins.add(FrequencyBin(frequencyHz = absoluteFreqHz, powerDbm = dBm))
        }

        return bins
    }
}