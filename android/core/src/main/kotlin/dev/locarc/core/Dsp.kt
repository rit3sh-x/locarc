package dev.locarc.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

// Measurement: every 16 KiB sweep-mode block → two 5 MHz slices of raster Channels → window
// accumulators → at window end, Emitters. All constants are compiled in; the app version is the
// DSP version. Starting values are in the Kotlin Receiver app spec and tuned by the DSP tests.

/** In-place radix-2 complex FFT. */
class Fft(
    val n: Int,
) {
    private val cosT = FloatArray(n / 2) { cos(-2 * PI * it / n).toFloat() }
    private val sinT = FloatArray(n / 2) { sin(-2 * PI * it / n).toFloat() }
    private val rev =
        IntArray(n).also { r ->
            val bits = Integer.numberOfTrailingZeros(n)
            require(1 shl bits == n) { "FFT size must be a power of two" }
            for (i in 0 until n) r[i] = Integer.reverse(i) ushr (32 - bits)
        }

    fun transform(
        re: FloatArray,
        im: FloatArray,
    ) {
        for (i in 0 until n) {
            val j = rev[i]
            if (j > i) {
                re[i] = re[j].also { re[j] = re[i] }
                im[i] = im[j].also { im[j] = im[i] }
            }
        }
        var size = 2
        while (size <= n) {
            val half = size / 2
            val step = n / size
            for (start in 0 until n step size) {
                for (k in 0 until half) {
                    val c = cosT[k * step]
                    val s = sinT[k * step]
                    val a = start + k
                    val b = a + half
                    val tr = re[b] * c - im[b] * s
                    val ti = re[b] * s + im[b] * c
                    re[b] = re[a] - tr
                    im[b] = im[a] - ti
                    re[a] += tr
                    im[a] += ti
                }
            }
            size *= 2
        }
    }
}

/**
 * Hann-windowed Welch power per bin of int8 IQ samples, DC removed, scaled so a full-scale
 * complex tone reads 1.0 (0 dBFS) in its bin.
 */
class Welch(
    val n: Int,
) {
    private val fft = Fft(n)
    private val window = FloatArray(n) { (0.5 - 0.5 * cos(2 * PI * it / n)).toFloat() }
    private val gain = window.sum().let { it * it }
    private val re = FloatArray(n)
    private val im = FloatArray(n)
    val power = FloatArray(n)

    /** Averages 50%-overlapping segments over [count] complex samples starting at byte [off]. */
    fun compute(
        data: ByteArray,
        off: Int,
        count: Int,
        meanI: Float,
        meanQ: Float,
    ) {
        power.fill(0f)
        var segments = 0
        var start = 0
        while (start + n <= count) {
            for (i in 0 until n) {
                val p = off + 2 * (start + i)
                re[i] = (data[p] - meanI) / 128f * window[i]
                im[i] = (data[p + 1] - meanQ) / 128f * window[i]
            }
            fft.transform(re, im)
            for (i in 0 until n) power[i] += re[i] * re[i] + im[i] * im[i]
            segments++
            start += n / 2
        }
        val scale = 1f / (gain * max(1, segments))
        for (i in 0 until n) power[i] *= scale
    }
}

enum class Fault {
    PERMISSION_DENIED,
    DETACHED,
    OPEN_FAILED,
    TUNE_FAILED,
    TRANSFER_TIMEOUT,
    TRANSFER_ERROR,
    SHORT_READ,
    ZERO_BUFFER,
    DC_ONLY,
    RESET_FAILED,
    POWER_FLAPPING,
    FIRMWARE_UNSUPPORTED,
}

/** What one window heard: the Reading payload plus its pass counts. */
data class WindowResult(
    val payload: ReadingPayload,
    val passes: Int,
    val fixPasses: Int,
)

/** Gains and corrections applied for a window (changes take effect only at a window edge). */
data class Tuning(
    val lnaDb: Int,
    val vgaDb: Int,
    val amp: Boolean,
    val ppm: Double,
    val offsetDb: Double,
) {
    val gainDb: Double get() = (lnaDb + vgaDb + if (amp) AMP_GAIN_DB else 0.0)

    companion object {
        /** The HackRF RF amplifier's nominal gain; only absolute dBm depends on it. */
        const val AMP_GAIN_DB = 11.0
    }
}

/**
 * Turns sweep-mode blocks into one window's Reading. Not thread-safe: one DSP thread owns it.
 * Blocks: a 0x7F 0x7F marker and the sweep frequency f (u64 LE), then int8 IQ; the HackRF is tuned
 * to f + 7.5 MHz, so the kept bins cover [f, f+5) and [f+10, f+15) MHz.
 */
class SweepProcessor(
    val plan: SweepPlan,
    private val sampleRate: Int = SAMPLE_RATE,
    /** The HackRF tunes this far above each block's sweep frequency. */
    private val tuneOffsetHz: Long = TUNE_OFFSET_HZ,
    /** Bins kept on each side of the tuned frequency: [inner, outer) Hz away from it. */
    private val innerHz: Double = 2_500_000.0,
    private val outerHz: Double = 7_500_000.0,
) {
    private val welch = Welch(FFT_N)
    private val binHz = sampleRate.toDouble() / FFT_N
    private val raster = plan.rasterHz
    private val channels = plan.channelCount
    private val sliceCount = plan.slices.size
    private val sliceOfChannel = IntArray(channels) { plan.sliceOf((plan.channelAt(it) * raster).toDouble()) }

    // Per Channel, over the window.
    private val fixSum = FloatArray(channels)
    private val maxPow = FloatArray(channels)
    private val maxSnr = FloatArray(channels)
    private val onCount = IntArray(channels)
    private val bins = ByteArray(channels)

    // Per slice, over the window.
    private val floorSum = DoubleArray(sliceCount)
    private val fixBlocks = IntArray(sliceCount)
    private val clippedFix = BooleanArray(sliceCount)
    private val clippedLater = BooleanArray(sliceCount)
    private val baseline = DoubleArray(sliceCount)

    // Scratch for one half-block.
    private val halfBins = FloatArray(FFT_N)
    private val chSum = FloatArray(MAX_HALF_CHANNELS)
    private val chBins = IntArray(MAX_HALF_CHANNELS)

    private var fixEndAt = 0L
    private var passes = 0
    private var fixPasses = 0
    private var lastTune = Long.MAX_VALUE
    private var tuning = Tuning(32, 30, false, 0.0, 0.0)

    fun startWindow(
        t: Tuning,
        fixEndAt: Long,
    ) {
        tuning = t
        this.fixEndAt = fixEndAt
        fixSum.fill(0f)
        maxPow.fill(0f)
        maxSnr.fill(0f)
        onCount.fill(0)
        floorSum.fill(0.0)
        fixBlocks.fill(0)
        clippedFix.fill(false)
        clippedLater.fill(false)
        passes = 0
        fixPasses = 0
        lastTune = Long.MAX_VALUE
    }

    /** One block. Returns a fault when the block is unusable (the ladder decides what to do). */
    fun block(
        data: ByteArray,
        off: Int,
        len: Int,
        now: Long,
    ): Fault? {
        if (len < BLOCK_BYTES) return Fault.SHORT_READ
        if (data[off] != 0x7F.toByte() || data[off + 1] != 0x7F.toByte()) return Fault.TRANSFER_ERROR
        var f = 0L
        for (i in 7 downTo 0) f = (f shl 8) or (data[off + 2 + i].toLong() and 0xff)
        val start = off + BLOCK_BYTES - 2 * SAMPLES_USED

        var sumI = 0L
        var sumQ = 0L
        var sumSq = 0L
        var clip = 0
        var nonZero = false
        for (i in 0 until SAMPLES_USED) {
            val a = data[start + 2 * i].toInt()
            val b = data[start + 2 * i + 1].toInt()
            sumI += a
            sumQ += b
            sumSq += a * a + b * b
            if (a <= -127 || a >= 127 || b <= -127 || b >= 127) clip++
            if (a != 0 || b != 0) nonZero = true
        }
        if (!nonZero) return Fault.ZERO_BUFFER
        val meanI = sumI.toFloat() / SAMPLES_USED
        val meanQ = sumQ.toFloat() / SAMPLES_USED
        val variance = sumSq.toDouble() / SAMPLES_USED - meanI * meanI - meanQ * meanQ
        if (sqrt(max(0.0, variance)) < DC_ONLY_RMS) return Fault.DC_ONLY

        val inFix = now < fixEndAt
        // Tunes rise through a pass; the next pass starts back at the bottom.
        if (f <= lastTune) {
            passes++
            if (inFix) fixPasses++
        }
        lastTune = f
        val clipped = clip > SAMPLES_USED * CLIP_SHARE

        welch.compute(data, start, SAMPLES_USED, meanI, meanQ)
        val center = f + tuneOffsetHz
        half(center, center - outerHz, center - innerHz, inFix, clipped)
        half(center, center + innerHz, center + outerHz, inFix, clipped)
        return null
    }

    /** One 5 MHz half of a block: its slice's floor, then every Channel centred inside it. */
    private fun half(
        center: Long,
        lo: Double,
        hi: Double,
        inFix: Boolean,
        clipped: Boolean,
    ) {
        val slice = plan.sliceOf((lo + hi) / 2)
        if (slice < 0) return
        val correction = 1 - tuning.ppm * 1e-6
        // Bins of Channels centred in [lo, hi); a Channel's bins may sit just outside.
        var nBins = 0
        val firstCh = Math.round(lo / raster)
        chSum.fill(0f)
        chBins.fill(0)
        for (k in 1 until FFT_N) {
            if (k == FFT_N / 2) continue
            val offset = (if (k < FFT_N / 2) k else k - FFT_N) * binHz
            val freq = (center + offset) * correction
            if (freq < lo - raster / 2.0 || freq >= hi + raster / 2.0) continue
            val ch = Math.round(freq / raster)
            val centreHz = ch * raster.toDouble()
            if (centreHz < lo || centreHz >= hi) continue
            val p = welch.power[k]
            halfBins[nBins++] = p
            val slot = (ch - firstCh + 1).toInt()
            if (slot !in 0 until MAX_HALF_CHANNELS) continue
            chSum[slot] += p
            chBins[slot]++
        }
        if (nBins == 0) return
        val floorBin = percentile(halfBins, nBins, FLOOR_PERCENTILE) * FLOOR_CORRECTION
        if (inFix) {
            floorSum[slice] += floorBin
            fixBlocks[slice]++
        }
        if (clipped) {
            if (inFix) {
                clippedFix[slice] = true
            } else {
                clippedLater[slice] = true
            }
        }
        for (slot in 0 until MAX_HALF_CHANNELS) {
            val nb = chBins[slot]
            if (nb == 0) continue
            val idx = plan.channelIndex(firstCh + slot - 1)
            if (idx < 0) continue
            if (bins[idx].toInt() == 0) bins[idx] = nb.toByte()
            val p = chSum[slot]
            val snr = (p / (floorBin * nb)).toFloat()
            if (inFix) fixSum[idx] += p
            if (p > maxPow[idx]) maxPow[idx] = p
            if (snr > maxSnr[idx]) maxSnr[idx] = snr
            if (snr >= ON_RATIO) onCount[idx]++
        }
    }

    /** The window's Reading: slices, then Emitters built from runs of detected Channels. */
    fun finish(): WindowResult {
        val t = tuning

        fun dbm(p: Double) = 10 * log10(max(p, 1e-30)) - t.gainDb + t.offsetDb
        val floorBin = DoubleArray(sliceCount) { if (fixBlocks[it] > 0) floorSum[it] / fixBlocks[it] else 0.0 }
        val perChannel = raster / binHz
        val slices =
            List(sliceCount) { s ->
                val floorDbm = if (fixBlocks[s] > 0) dbm(floorBin[s] * perChannel) else NO_FLOOR_DBM
                val anomaly = baseline[s] > 0 && floorBin[s] > baseline[s] * ANOMALY_RATIO
                if (fixBlocks[s] > 0) baseline[s] = if (baseline[s] == 0.0) floorBin[s] else 0.8 * baseline[s] + 0.2 * floorBin[s]
                Slice(floorDbm, clippedFix[s], clippedLater[s], anomaly)
            }

        val avg = DoubleArray(channels)
        val noise = DoubleArray(channels)
        val detected = BooleanArray(channels)
        for (c in 0 until channels) {
            val s = sliceOfChannel[c]
            if (s < 0) continue
            noise[c] = floorBin[s] * max(1, bins[c].toInt())
            if (fixBlocks[s] > 0) avg[c] = fixSum[c].toDouble() / fixBlocks[s]
            val heardAvg = fixBlocks[s] > 0 && noise[c] > 0 && avg[c] >= DETECT_AVG_RATIO * noise[c]
            detected[c] = (heardAvg || maxSnr[c] >= DETECT_PASS_RATIO) && !plan.isSpur(plan.channelAt(c))
        }

        // Runs of detected Channels with consecutive channel numbers, then gap bridging.
        val runs = mutableListOf<IntRange>()
        var c = 0
        while (c < channels) {
            if (!detected[c]) {
                c++
                continue
            }
            var e = c
            while (e + 1 < channels && detected[e + 1] && plan.channelAt(e + 1) == plan.channelAt(e) + 1) e++
            runs += c..e
            c = e + 1
        }
        val merged = mutableListOf<IntRange>()
        for (r in runs) {
            val prev = merged.lastOrNull()
            if (prev != null) {
                val gap = plan.channelAt(r.first) - plan.channelAt(prev.last) - 1
                val wider = max(prev.last - prev.first + 1, r.last - r.first + 1)
                if (gap <= max(BRIDGE_MIN_CHANNELS.toDouble(), wider * BRIDGE_SHARE)) {
                    merged[merged.lastIndex] = prev.first..r.last
                    continue
                }
            }
            merged += r
        }

        val emitters =
            merged.map { r ->
                var fixTotal = 0.0
                var heardInFix = false
                var strongest = r.first
                var best = -1.0
                var peak = 0f
                var on = 0
                var clipFix = false
                var clipLater = false
                for (i in r) {
                    fixTotal += avg[i]
                    if (noise[i] > 0 && avg[i] >= DETECT_AVG_RATIO * noise[i]) heardInFix = true
                    peak = max(peak, maxPow[i])
                    on = max(on, onCount[i])
                    val s = sliceOfChannel[i]
                    if (s >= 0) {
                        clipFix = clipFix || clippedFix[s]
                        clipLater = clipLater || clippedLater[s]
                    }
                }
                for (i in r) {
                    val score = if (heardInFix) avg[i] else maxPow[i].toDouble()
                    if (score > best) {
                        best = score
                        strongest = i
                    }
                }
                EmitterRecord(
                    firstCh = plan.channelAt(r.first),
                    widthCh = (plan.channelAt(r.last) - plan.channelAt(r.first) + 1).toInt(),
                    strongestCh = plan.channelAt(strongest),
                    fixPowerDbm = if (heardInFix) dbm(fixTotal) else null,
                    peakDbm = dbm(peak.toDouble()),
                    passesOn = on,
                    clippedFix = clipFix,
                    clippedLater = clipLater,
                )
            }
        val kept =
            if (emitters.size <= ReadingCodec.MAX_EMITTERS) {
                emitters
            } else {
                emitters.sortedByDescending { it.fixPowerDbm ?: it.peakDbm }.take(ReadingCodec.MAX_EMITTERS)
            }
        return WindowResult(ReadingPayload(slices, kept.sortedBy { it.firstCh }), passes, fixPasses)
    }

    companion object {
        const val SAMPLE_RATE = 20_000_000
        const val BLOCK_BYTES = 16_384
        const val TUNE_OFFSET_HZ = 7_500_000L
        const val FFT_N = 2048

        /** The last 4096 samples of each block: three 50%-overlapping 2048-point segments. */
        const val SAMPLES_USED = 4096
        const val CLIP_SHARE = 0.001
        const val DC_ONLY_RMS = 0.3
        const val FLOOR_PERCENTILE = 0.2

        /** P20 of a bin's 3-segment Welch power, scaled back to the mean noise power. */
        const val FLOOR_CORRECTION = 2.0
        const val ON_RATIO = 10f
        const val DETECT_AVG_RATIO = 10.0
        const val DETECT_PASS_RATIO = 31.6f
        const val BRIDGE_MIN_CHANNELS = 2
        const val BRIDGE_SHARE = 0.25
        const val ANOMALY_RATIO = 10.0
        const val NO_FLOOR_DBM = -200.0
        private const val MAX_HALF_CHANNELS = 1024
    }
}

/** The p-quantile of the first [n] values (copies; the half-block arrays are small). */
internal fun percentile(
    values: FloatArray,
    n: Int,
    p: Double,
): Double {
    val copy = values.copyOf(n)
    copy.sort()
    return copy[((n - 1) * p).roundToLong().toInt()].toDouble()
}

/**
 * Calibration: a reference carrier measured outside sweep mode at 10 MS/s, tuned 1 MHz below it
 * so DC sits clear, with the calibration offset and ppm correction off.
 */
class CarrierMeter(
    private val referenceHz: Double,
    private val sampleRate: Int = 10_000_000,
) {
    private val n = 65_536
    private val welch = Welch(n)
    private val sum = DoubleArray(n)
    private var spectra = 0
    val tunedHz: Long = (referenceHz - 1_000_000).roundToLong()

    /** Raw int8 IQ (no headers): every full 65,536-sample stretch adds one spectrum. */
    fun samples(
        data: ByteArray,
        off: Int,
        count: Int,
    ) {
        var start = off
        while (start + 2 * n <= off + 2 * count) {
            var si = 0L
            var sq = 0L
            for (i in 0 until n) {
                si += data[start + 2 * i]
                sq += data[start + 2 * i + 1]
            }
            welch.compute(data, start, n, si.toFloat() / n, sq.toFloat() / n)
            for (i in 0 until n) sum[i] += welch.power[i].toDouble()
            spectra++
            start += 2 * n
        }
    }

    /** Power (gain-compensated, no calibration offset) and offset from the reference, in Hz. */
    fun result(gainDb: Double): Pair<Double, Double>? {
        if (spectra == 0) return null
        val binHz = sampleRate.toDouble() / n
        val expect = Math.round((referenceHz - tunedHz) / binHz).toInt()
        val span = (200_000 / binHz).toInt()
        var peak = expect
        for (k in expect - span..expect + span) if (sum[k] > sum[peak]) peak = k
        var p = 0.0
        for (k in peak - 3..peak + 3) p += sum[k] / spectra
        // Parabolic interpolation of the peak in dB.
        val a = 10 * log10(sum[peak - 1])
        val b = 10 * log10(sum[peak])
        val c = 10 * log10(sum[peak + 1])
        val shift = 0.5 * (a - c) / (a - 2 * b + c)
        val measured = tunedHz + (peak + shift) * binHz
        return (10 * log10(p) - gainDb) to (measured - referenceHz)
    }
}
