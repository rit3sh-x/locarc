package com.locarc.mobile.algorithms

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.round
import kotlin.math.sqrt

class SpectrumAnalyzer(
    private val centerFreqHz: Double = 435e6,
    private val bbSampleRate: Double = 20e6,
    private val signalBandwidth: Double = 200e3,
    private val channelSpacing: Double = 10e3,
    private val startFrequency: Double = 300e6,
    private val endFrequency: Double = 500e6,
    private val channelGrid: Double = 12.5e3,
    private val maxThreshold: Double = 0.09,
    private val maxThresholdP1: Double = 0.35,
    private val requiredFs1: Double = 200e3,
    private val zoomFsPower: Double = 50e3,
    private val priorKnowledgeBw: Double = 12.5e3
) {
    data class PowerMeasurement(val frequency: Double, val powerDbm: Double)

    fun analyzeSpectrum(iqData: Array<Complex>): List<PowerMeasurement> {
        val globalFrequencies = detectGlobalFrequencies(iqData)
        val uniqueFrequencies = globalFrequencies.distinct().sorted()
        return measurePower(iqData, uniqueFrequencies)
    }

    private fun detectGlobalFrequencies(rawData: Array<Complex>): List<Double> {
        val frameSize = rawData.size

        val (bHp, aHp) = DspUtils.butter(1, 0.0001, highPass = true)
        val data = DspUtils.filtfilt(bHp, aHp, rawData)

        val perOlf = 0.0
        val numSamUseM = (0.5 * frameSize).toInt()
        val zoomK = frameSize / numSamUseM

        val w3 = DspUtils.kaiserWindow(numSamUseM, 36.0)
        val sumW3 = w3.sum()

        val (framesRaw, numFragments) = DspUtils.generateOverlappingFrames(perOlf, data, numSamUseM)

        val frames = framesRaw.map { frame ->
            Array(numSamUseM) { j -> frame[j] * w3[j] }
        }

        val totalFftSize = numSamUseM * zoomK
        val freqStep = bbSampleRate / totalFftSize
        val frequencyAxisZoom = DoubleArray(totalFftSize) { i ->
            -bbSampleRate / 2.0 + i * freqStep
        }

        val (_, peakPowers, peakFrequencies) = whAvgFftZoomPk(
            frames, zoomK, numSamUseM, numFragments,
            frequencyAxisZoom, signalBandwidth, maxThreshold, sumW3
        )

        val numPeakFreq = peakFrequencies.size
        val globalFreqs = mutableListOf<Double>()

        val noiseStage1 = isNoisySpectrum(peakPowers, threshold = 10.0, minPeaks = 10)

        if (!noiseStage1) {
            for (nPeaks in 0 until numPeakFreq) {
                val freq1 = peakFrequencies[nPeaks]

                val iqShifted = DspUtils.frequencyShift(data, bbSampleRate, -freq1)
                val decimated = DspUtils.lpfAndDownsample(2, 0.03, iqShifted, bbSampleRate, requiredFs1)

                val sigBwP1 = channelSpacing
                val numSamP1 = (decimated.size * 0.5).toInt()
                val zoomKP1 = decimated.size / numSamP1

                val w3P1 = DspUtils.kaiserWindow(numSamP1, 60.0)
                val sumW3P1 = w3P1.sum()

                val (framesP1Raw, numFragsP1) = DspUtils.generateOverlappingFrames(0.0, decimated, numSamP1)
                val framesP1 = framesP1Raw.map { frame ->
                    Array(numSamP1) { j -> frame[j] * w3P1[j] }
                }

                val totalFftP1 = numSamP1 * zoomKP1
                val freqStepP1 = requiredFs1 / totalFftP1
                val freqAxisP1 = DoubleArray(totalFftP1) { i ->
                    -requiredFs1 / 2.0 + i * freqStepP1
                }

                val (_, peakPowersP1, peakFreqsP1) = whAvgFftZoomPk(
                    framesP1, zoomKP1, numSamP1, numFragsP1,
                    freqAxisP1, sigBwP1, maxThresholdP1, sumW3P1
                )

                val noiseP1 = isNoisySpectrum(peakPowersP1, threshold = 10.0, minPeaks = 5)

                if (!noiseP1) {
                    for (idx in peakFreqsP1.indices) {
                        globalFreqs.add(centerFreqHz + freq1 + peakFreqsP1[idx])
                    }
                }
            }
        }

        return globalFreqs
    }

    private fun measurePower(
        rawData: Array<Complex>,
        targetFrequencies: List<Double>
    ): List<PowerMeasurement> {
        val results = mutableListOf<PowerMeasurement>()

        for (peakFreqAbs in targetFrequencies) {
            val peakFreqOffset = peakFreqAbs - centerFreqHz
            val iqShifted = DspUtils.frequencyShift(rawData, bbSampleRate, -peakFreqOffset)
            val iqZoomed = DspUtils.lpfAndDownsample(2, 0.03, iqShifted, bbSampleRate, zoomFsPower)

            val n = iqZoomed.size
            val win = DspUtils.kaiserWindow(n, 60.0)

            val windowed = Array(n) { i -> iqZoomed[i] * win[i] }
            val fftSize = FftEngine.nextPowerOf2(n)
            val fftResult = FftEngine.fftShifted(windowed, fftSize)

            val freqStep = zoomFsPower / fftSize
            val freqAxis = DoubleArray(fftSize) { i -> -zoomFsPower / 2.0 + i * freqStep }

            var finePeakIdx = 0
            var maxAbs = fftResult[0].abs()
            for (i in 1 until fftSize) {
                val currAbs = fftResult[i].abs()
                if (currAbs > maxAbs) {
                    maxAbs = currAbs
                    finePeakIdx = i
                }
            }

            val fineFreqOffset = freqAxis[finePeakIdx]
            val finalCorrectedFreq = peakFreqAbs + fineFreqOffset

            var u = 0.0
            for (i in 0 until n) u += win[i] * win[i]
            u /= n

            val psd = DoubleArray(fftSize) { i ->
                val a = fftResult[i].abs()
                (a * a) / (u * zoomFsPower * fftSize)
            }

            val df = freqAxis[1] - freqAxis[0]
            var powerWatts = 0.0
            for (i in 0 until fftSize) {
                if (freqAxis[i] >= -priorKnowledgeBw / 2.0 && freqAxis[i] <= priorKnowledgeBw / 2.0) {
                    powerWatts += psd[i] * df
                }
            }

            if (powerWatts > 0) {
                val powerDbm = 10.0 * log10(powerWatts / 0.001)
                results.add(PowerMeasurement(finalCorrectedFreq, powerDbm))
            }
        }

        return results
    }

    private data class ZoomPkResult(
        val fftAvg: Array<Complex>,
        val peakPowers: List<Double>,
        val peakFrequencies: List<Double>
    )

    private fun whAvgFftZoomPk(
        windowedFrames: List<Array<Complex>>,
        zoomK: Int,
        numSamples: Int,
        numFragments: Int,
        frequencyAxis: DoubleArray,
        sigBw: Double,
        maxTh: Double,
        sumW3: Double
    ): ZoomPkResult {
        val totalFftSize = numSamples * zoomK
        val paddedSize = FftEngine.nextPowerOf2(totalFftSize)

        val fftSum = Array(paddedSize) { Complex.ZERO }

        val framesToUse = minOf(numFragments, windowedFrames.size)
        for (i in 0 until framesToUse) {
            val fftResult = FftEngine.fftShifted(windowedFrames[i], paddedSize)
            for (j in 0 until paddedSize) {
                fftSum[j] = fftSum[j] + fftResult[j]
            }
        }

        val xasDb = DoubleArray(paddedSize) { i ->
            val xa = fftSum[i].abs()
            val xas = 2.0 * xa / sumW3
            20.0 * log10(xas + 1e-300)
        }

        val maxDb = xasDb.max()
        val threshold = 20.0 * log10(maxTh) + maxDb

        val freqResolution = if (frequencyAxis.size >= 2) frequencyAxis[1] - frequencyAxis[0]
        else 1.0
        val distance = round(sigBw / freqResolution).toInt()

        val effectiveDb = if (paddedSize <= frequencyAxis.size) xasDb
        else DoubleArray(frequencyAxis.size) { xasDb[it] }

        val locs = DspUtils.findPeaks(effectiveDb, threshold, distance)

        val peakPowers = locs.map { effectiveDb[it] }
        val peakFrequencies = locs.map { frequencyAxis[it] }

        return ZoomPkResult(fftSum, peakPowers, peakFrequencies)
    }

    private fun mapToBand(inputFrequency: Double): Double {
        val channelIndex = round((inputFrequency - startFrequency) / channelGrid) + 1.0
        return startFrequency + (channelIndex - 1.0) * channelGrid
    }

    private fun isNoisySpectrum(
        peakPowers: List<Double>,
        threshold: Double,
        minPeaks: Int
    ): Boolean {
        if (peakPowers.size < minPeaks || peakPowers.size < 2) return false

        val diffs = (0 until peakPowers.size - 1).map {
            abs(peakPowers[it + 1] - peakPowers[it])
        }
        val minDiff = diffs.min()
        return minDiff <= threshold
    }
}
