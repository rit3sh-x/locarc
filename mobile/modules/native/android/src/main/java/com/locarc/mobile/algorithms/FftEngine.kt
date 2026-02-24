package com.locarc.mobile.algorithms

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

object FftEngine {
    fun fftForward(data: Array<Complex>) {
        val n = data.size
        require(n > 0 && (n and (n - 1)) == 0) { "FFT size must be a power of 2, got $n" }

        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                val temp = data[i]
                data[i] = data[j]
                data[j] = temp
            }
        }

        var len = 2
        while (len <= n) {
            val halfLen = len / 2
            val angle = -2.0 * PI / len
            val wBase = Complex(cos(angle), sin(angle))

            var i = 0
            while (i < n) {
                var w = Complex(1.0, 0.0)
                for (k in 0 until halfLen) {
                    val u = data[i + k]
                    val t = w * data[i + k + halfLen]
                    data[i + k] = u + t
                    data[i + k + halfLen] = u - t
                    w = w * wBase
                }
                i += len
            }
            len = len shl 1
        }
    }

    fun fftShifted(input: Array<Complex>, totalSize: Int): Array<Complex> {
        val padded = zeroPad(input, totalSize)
        fftForward(padded)

        val half = totalSize / 2
        val shifted = Array(totalSize) { Complex.ZERO }
        for (i in 0 until totalSize) {
            shifted[(i + half) % totalSize] = padded[i]
        }
        return shifted
    }

    fun zeroPad(data: Array<Complex>, size: Int): Array<Complex> {
        return Array(size) { i -> if (i < data.size) data[i] else Complex.ZERO }
    }

    fun nextPowerOf2(n: Int): Int {
        if (n <= 1) return 1
        var p = 1
        while (p < n) p = p shl 1
        return p
    }
}
