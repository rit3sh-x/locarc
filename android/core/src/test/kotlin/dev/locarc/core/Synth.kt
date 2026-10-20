package dev.locarc.core

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** A carrier for synthetic IQ: [amplitude] in ADC counts (127 is full scale). */
data class Tone(
    val freqHz: Double,
    val amplitude: Double,
    /** Occupied bandwidth: > 0 makes band-limited noise instead of a pure tone. */
    val bandwidthHz: Double = 0.0,
    /** Whether it transmits at this moment (ms since the scene began). */
    val on: (Long) -> Boolean = { true },
)

/** Synthetic sweep-mode blocks, as the HackRF firmware sends them, from a scene of tones. */
class Synth(
    seed: Long = 1,
    private val sampleRate: Double = SweepProcessor.SAMPLE_RATE.toDouble(),
) {
    private val rand = Random(seed)
    var noiseRms = 2.0
    var dc = Pair(-0.4, 1.4)

    /** The tune sequence of one pass, as INIT_SWEEP's interleaved mode produces it. */
    fun tunes(plan: SweepPlan): List<Long> =
        plan.segments.flatMap { s ->
            generateSequence(
                s.startHz,
            ) { it + SweepPlan.TUNE_HZ }.takeWhile { it < s.endHz }.flatMap { listOf(it, it + 5_000_000) }.toList()
        }

    /** One 16 KiB block at sweep frequency [f] (tuned to f + 7.5 MHz). */
    fun block(
        f: Long,
        tones: List<Tone>,
        atMs: Long,
        into: ByteArray = ByteArray(SweepProcessor.BLOCK_BYTES),
        off: Int = 0,
        center: Double = f + SweepProcessor.TUNE_OFFSET_HZ.toDouble(),
    ): ByteArray {
        val header =
            ByteBuffer
                .allocate(10)
                .order(ByteOrder.LITTLE_ENDIAN)
                .put(0x7F)
                .put(0x7F)
                .putLong(f)
                .array()
        header.copyInto(into, off)
        // Only the samples the processor uses (the end of the block) are synthesised.
        val n = SweepProcessor.SAMPLES_USED
        val re = DoubleArray(n) { dc.first + rand.nextGaussian() * noiseRms }
        val im = DoubleArray(n) { dc.second + rand.nextGaussian() * noiseRms }
        for (t in tones) {
            if (!t.on(atMs)) continue
            val d = t.freqHz - center
            if (kotlin.math.abs(d) > sampleRate / 2) continue
            if (t.bandwidthHz <= 0) {
                val phase0 = rand.nextDouble() * 2 * PI
                for (i in 0 until n) {
                    val ph = phase0 + 2 * PI * d * i / sampleRate
                    re[i] += t.amplitude * cos(ph)
                    im[i] += t.amplitude * sin(ph)
                }
            } else {
                // Band-limited noise: many tones with random phases across the bandwidth.
                val k = 64
                val each = t.amplitude / kotlin.math.sqrt(k.toDouble())
                for (j in 0 until k) {
                    val fj = d - t.bandwidthHz / 2 + t.bandwidthHz * (j + 0.5) / k
                    val phase0 = rand.nextDouble() * 2 * PI
                    for (i in 0 until n) {
                        val ph = phase0 + 2 * PI * fj * i / sampleRate
                        re[i] += each * cos(ph)
                        im[i] += each * sin(ph)
                    }
                }
            }
        }
        val start = off + SweepProcessor.BLOCK_BYTES - 2 * n
        for (i in 0 until n) {
            into[start + 2 * i] = re[i].roundToInt().coerceIn(-128, 127).toByte()
            into[start + 2 * i + 1] = im[i].roundToInt().coerceIn(-128, 127).toByte()
        }
        return into
    }

    /** Runs whole passes through [p] for [ms] of scene time, one pass every [passMs]. */
    fun run(
        p: SweepProcessor,
        plan: SweepPlan,
        tones: List<Tone>,
        fromMs: Long,
        ms: Long,
        passMs: Long = 150,
    ) {
        val buf = ByteArray(SweepProcessor.BLOCK_BYTES)
        var t = fromMs
        while (t < fromMs + ms) {
            for (f in tunes(plan)) {
                block(f, tones, t, buf)
                check(p.block(buf, 0, buf.size, t) == null)
            }
            t += passMs
        }
    }
}
