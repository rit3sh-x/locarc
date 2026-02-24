package com.locarc.mobile.algorithms

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.round
import kotlin.math.sqrt
import kotlin.math.tan

object DspUtils {
    data class FilterCoeffs(val b: DoubleArray, val a: DoubleArray)

    fun butter(order: Int, cutoff: Double, highPass: Boolean = false): FilterCoeffs {
        val wc = tan(PI * cutoff)
        return when (order) {
            1 -> {
                if (highPass) {
                    FilterCoeffs(
                        b = doubleArrayOf(1.0 / (1.0 + wc), -1.0 / (1.0 + wc)),
                        a = doubleArrayOf(1.0, (wc - 1.0) / (1.0 + wc))
                    )
                } else {
                    FilterCoeffs(
                        b = doubleArrayOf(wc / (1.0 + wc), wc / (1.0 + wc)),
                        a = doubleArrayOf(1.0, (wc - 1.0) / (1.0 + wc))
                    )
                }
            }
            2 -> {
                val sqrt2 = sqrt(2.0)
                val wc2 = wc * wc
                val denom = 1.0 + sqrt2 * wc + wc2
                FilterCoeffs(
                    b = doubleArrayOf(wc2 / denom, 2.0 * wc2 / denom, wc2 / denom),
                    a = doubleArrayOf(1.0, 2.0 * (wc2 - 1.0) / denom, (1.0 - sqrt2 * wc + wc2) / denom)
                )
            }
            else -> throw IllegalArgumentException("Only order 1 and 2 are supported")
        }
    }

    fun filtfilt(
        b: DoubleArray,
        a: DoubleArray,
        input: Array<Complex>
    ): Array<Complex> {
        val n = input.size
        val forward = Array(n) { Complex.ZERO }

        forward[0] = input[0] * b[0]
        for (i in 1 until n) {
            var acc = Complex.ZERO
            for (j in b.indices) {
                if (j <= i) acc = acc + input[i - j] * b[j]
            }
            for (j in 1 until a.size) {
                if (j <= i) acc = acc - forward[i - j] * a[j]
            }
            forward[i] = acc
        }

        val output = Array(n) { Complex.ZERO }
        output[n - 1] = forward[n - 1] * b[0]
        for (i in n - 2 downTo 0) {
            var acc = Complex.ZERO
            for (j in b.indices) {
                if (i + j < n) acc = acc + forward[i + j] * b[j]
            }
            for (j in 1 until a.size) {
                if (i + j < n) acc = acc - output[i + j] * a[j]
            }
            output[i] = acc
        }

        return output
    }

    fun decimate(signal: Array<Complex>, factor: Int): Array<Complex> {
        val outSize = (signal.size + factor - 1) / factor
        return Array(outSize) { signal[it * factor] }
    }

    fun lpfAndDownsample(
        order: Int,
        cutoff: Double,
        signal: Array<Complex>,
        currentSr: Double,
        newSr: Double
    ): Array<Complex> {
        val (b, a) = butter(order, cutoff, highPass = false)
        val filtered = filtfilt(b, a, signal)
        val r = (currentSr / newSr).toInt()
        return decimate(filtered, r)
    }

    fun kaiserWindow(n: Int, beta: Double): DoubleArray {
        val w = DoubleArray(n)
        val alpha = (n - 1) / 2.0
        val denom = besselI0(beta)
        for (i in 0 until n) {
            val arg = (i - alpha) / alpha
            val x = beta * sqrt(1.0 - arg * arg)
            w[i] = besselI0(x) / denom
        }
        return w
    }

    fun hannWindow(n: Int): DoubleArray {
        val w = DoubleArray(n)
        val nm1 = n - 1
        for (i in 0..nm1) {
            w[i] = 0.5 * (1.0 - cos(2.0 * PI * i / nm1))
        }
        return w
    }

    fun besselI0(x: Double): Double {
        var sum = 1.0
        var term = 1.0
        val xHalfSq = (x / 2.0) * (x / 2.0)
        for (k in 1 until 50) {
            term *= xHalfSq / (k.toDouble() * k.toDouble())
            sum += term
            if (term < 1e-12 * sum) break
        }
        return sum
    }

    fun findPeaks(data: DoubleArray, height: Double, distance: Int): List<Int> {
        val peaks = mutableListOf<Int>()

        for (i in 1 until data.size - 1) {
            if (data[i] > height && data[i] >= data[i - 1] && data[i] >= data[i + 1]) {
                if (data[i] > data[i - 1] || data[i] > data[i + 1]) {
                    peaks.add(i)
                }
            }
        }

        if (distance > 0 && peaks.isNotEmpty()) {
            val keep = BooleanArray(peaks.size) { true }
            for (i in peaks.indices) {
                if (!keep[i]) continue
                for (j in i + 1 until peaks.size) {
                    if (abs(peaks[j] - peaks[i]) < distance) {
                        if (data[peaks[j]] > data[peaks[i]]) {
                            keep[i] = false
                            break
                        } else {
                            keep[j] = false
                        }
                    }
                }
            }
            return peaks.filterIndexed { index, _ -> keep[index] }
        }

        return peaks
    }

    fun frequencyShift(
        signal: Array<Complex>,
        sampleRate: Double,
        freqShift: Double
    ): Array<Complex> {
        return Array(signal.size) { i ->
            val t = i.toDouble() / sampleRate
            val phase = 2.0 * PI * freqShift * t
            signal[i] * Complex(cos(phase), kotlin.math.sin(phase))
        }
    }

    fun generateOverlappingFrames(
        overlapFraction: Double,
        frame: Array<Complex>,
        m: Int
    ): Pair<List<Array<Complex>>, Int> {
        val overlap = round(overlapFraction * m).toInt()
        val stepSize = m - overlap
        val frameSize = frame.size
        var numFragments = floor((frameSize - m).toDouble() / stepSize).toInt() + 2

        val frames = mutableListOf<Array<Complex>>()

        if (overlapFraction != 0.0) {
            for (i in 1 until numFragments) {
                val startIndex = (i - 1) * stepSize
                frames.add(Array(m) { j ->
                    if (startIndex + j < frameSize) frame[startIndex + j] else Complex.ZERO
                })
            }
            frames.add(Array(m) { j -> frame[frameSize - m + j] })
        } else {
            numFragments -= 1
            for (i in 1..numFragments) {
                val startIndex = (i - 1) * stepSize
                frames.add(Array(m) { j ->
                    if (startIndex + j < frameSize) frame[startIndex + j] else Complex.ZERO
                })
            }
        }

        return Pair(frames, if (overlapFraction != 0.0) numFragments else numFragments)
    }
}
