package dev.locarc.core

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToLong

// The Sweep plan as the control document carries it, and what the phone derives from it. The
// slices match convex/lib/config.ts: each segment splits into 5 MHz slices from its start.

data class Segment(
    val startHz: Long,
    val endHz: Long,
)

data class SweepPlan(
    val segments: List<Segment>,
    val rasterHz: Long,
) {
    /** The plan's 5 MHz slices, in order: each segment from its start, the last one shorter. */
    val slices: List<Segment> =
        segments.flatMap { s ->
            generateSequence(s.startHz) { it + SLICE_HZ }
                .takeWhile { it < s.endHz }
                .map { Segment(it, minOf(s.endHz, it + SLICE_HZ)) }
                .toList()
        }

    /** Index of the slice holding a frequency, or −1 outside the plan. */
    fun sliceOf(freqHz: Double): Int {
        var i = 0
        for (s in segments) {
            val n = ceil((s.endHz - s.startHz).toDouble() / SLICE_HZ).toInt()
            if (freqHz >= s.startHz && freqHz < s.endHz) return i + ((freqHz - s.startHz) / SLICE_HZ).toInt()
            i += n
        }
        return -1
    }

    /** Channel numbers the plan covers, per segment: [first, last). */
    val channelRanges: List<LongRange> =
        segments.map { s ->
            val first = (s.startHz.toDouble() / rasterHz).roundToLong()
            val last = (s.endHz.toDouble() / rasterHz).roundToLong()
            first until last
        }

    val channelCount: Int = channelRanges.sumOf { (it.last - it.first + 1).toInt() }

    /** Dense index of a channel number in the plan, or −1. */
    fun channelIndex(ch: Long): Int {
        var base = 0
        for (r in channelRanges) {
            if (ch in r) return base + (ch - r.first).toInt()
            base += (r.last - r.first + 1).toInt()
        }
        return -1
    }

    /** Channel number of a dense index. */
    fun channelAt(index: Int): Long {
        var rest = index
        for (r in channelRanges) {
            val n = (r.last - r.first + 1).toInt()
            if (rest < n) return r.first + rest
            rest -= n
        }
        error("index $index outside the plan")
    }

    fun tuneCount(): Int = segments.sumOf { maxOf(1, ceil((it.endHz - it.startHz).toDouble() / TUNE_HZ).toInt()) }

    /** One pass over every segment, as measured (about 0.15 s for the bug bands). */
    fun passMs(): Double = tuneCount() * TUNE_MS

    /** Within ±2 Channels of a 20 MHz multiple: the HackRF's own clock spurs. */
    fun isSpur(ch: Long): Boolean {
        val f = ch * rasterHz
        val nearest = Math.round(f.toDouble() / SPUR_EVERY_HZ) * SPUR_EVERY_HZ
        return abs(f - nearest) <= SPUR_MASK_CHANNELS * rasterHz
    }

    companion object {
        const val SLICE_HZ = 5_000_000L
        const val TUNE_HZ = 20_000_000L
        const val TUNE_MS = 2.7
        const val SPUR_EVERY_HZ = 20_000_000L
        const val SPUR_MASK_CHANNELS = 2
    }
}

/** What the control document says about the current Run. */
data class RunInfo(
    val runId: String,
    val number: Int,
    val startsAt: Long,
    val periodMs: Long,
    val plan: SweepPlan,
    val fixWindowMs: Long,
    val uploadMarginMs: Long,
    val burstEndsAt: Long?,
) {
    fun boundary(k: Long): Long = startsAt + k * periodMs

    /** The Scan whose slot contains `now` (−1 before the Run starts). */
    fun scanAt(now: Long): Long = Math.floorDiv(now - startsAt, periodMs)

    /** Whether Scan k belongs to the Run (bursts stop at their end). */
    fun inRun(k: Long): Boolean = k >= 0 && (burstEndsAt == null || boundary(k) < burstEndsAt)
}
