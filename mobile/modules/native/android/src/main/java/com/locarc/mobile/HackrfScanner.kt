package com.locarc.mobile

import com.locarc.mobile.algorithms.Complex

data class ScanSettings(
    val minFrequencyHz: Long,
    val maxFrequencyHz: Long,
    val sampleRateHz: Int = 10_000_000,
    val lnaGainDb: Int = 16,
    val vgaGainDb: Int = 20,
    val bufferSizeKb: Int = 256,
    val chunksPerStep: Int = 16
)

object HackrfScanner {
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
}
