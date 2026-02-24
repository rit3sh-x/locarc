package com.locarc.mobile.algorithms

import kotlin.math.sqrt
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.atan2

data class Complex(val re: Double, val im: Double) {

    companion object {
        val ZERO = Complex(0.0, 0.0)

        fun polar(magnitude: Double, phase: Double): Complex =
            Complex(magnitude * cos(phase), magnitude * sin(phase))
    }

    operator fun plus(other: Complex) = Complex(re + other.re, im + other.im)
    operator fun minus(other: Complex) = Complex(re - other.re, im - other.im)

    operator fun times(other: Complex) = Complex(
        re * other.re - im * other.im,
        re * other.im + im * other.re
    )

    operator fun times(scalar: Double) = Complex(re * scalar, im * scalar)
    operator fun div(scalar: Double) = Complex(re / scalar, im / scalar)

    fun abs(): Double = sqrt(re * re + im * im)
    fun absSq(): Double = re * re + im * im
    fun conj(): Complex = Complex(re, -im)
    fun phase(): Double = atan2(im, re)

    override fun toString(): String = "($re + ${im}i)"
}
