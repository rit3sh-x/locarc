package com.locarc.mobile.algorithms

import org.jtransforms.fft.DoubleFFT_1D

object FftEngine {

    private val planCache = HashMap<Int, DoubleFFT_1D>()

    private fun planFor(n: Int): DoubleFFT_1D =
        synchronized(planCache) { planCache.getOrPut(n) { DoubleFFT_1D(n.toLong()) } }

    fun fftForward(data: Array<Complex>) {
        val n = data.size
        require(n > 0) { "FFT size must be positive, got $n" }

        val buf = DoubleArray(2 * n)
        for (i in 0 until n) {
            buf[2 * i] = data[i].re
            buf[2 * i + 1] = data[i].im
        }
        planFor(n).complexForward(buf)
        for (i in 0 until n) {
            data[i] = Complex(buf[2 * i], buf[2 * i + 1])
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
