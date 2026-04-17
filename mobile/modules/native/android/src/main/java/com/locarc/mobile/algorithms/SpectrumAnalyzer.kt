package com.locarc.mobile.algorithms

import android.util.Log
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.round
import kotlin.math.sqrt

class SpectrumAnalyzer(
    private val centerFreqHz: Double,
    private val bbSampleRate: Double,
    private val config: AlgoConfig = AlgoConfig()
) {
    companion object {
        private const val TAG = "SpectrumAnalyzer"
    }

    data class PowerMeasurement(val frequency: Double, val powerDbm: Double)

    private data class ZoomPkResult(
        val fftAvg: Array<Complex>,
        val peakPowers: List<Double>,
        val peakFrequencies: List<Double>
    )

    fun analyzeSpectrum(iqData: Array<Complex>): List<PowerMeasurement> {
        Log.d(TAG, "analyzeSpectrum: ${iqData.size} samples @ ${centerFreqHz / 1e6} MHz fs=${bbSampleRate / 1e6} MHz")
        val globalFrequencies = detectGlobalFrequencies(iqData)
        val gridHz = config.channelMapping.channelSpacingMapHz
        val uniqueFrequencies = globalFrequencies
            .map { kotlin.math.round(it / gridHz) * gridHz }
            .distinct()
            .sorted()
        Log.d(TAG, "analyzeSpectrum: ${uniqueFrequencies.size} unique candidates after phase1/phase2")
        val measurements = measurePower(iqData, uniqueFrequencies)
        Log.d(TAG, "analyzeSpectrum: ${measurements.size} measurements after phase3")
        return measurements
    }


    private fun detectGlobalFrequencies(rawData: Array<Complex>): List<Double> {
        val p1 = config.phase1
        val p2 = config.phase2
        val frameSize = rawData.size

        val (bHp, aHp) = DspUtils.butter(p1.highpassOrder, p1.highpassCutoff, highPass = true)
        val data = DspUtils.filtfilt(bHp, aHp, rawData)

        val numSamUseM = (p1.numSamUseRatio * frameSize).toInt()
        val zoomK = frameSize / numSamUseM

        val w3 = DspUtils.kaiserWindow(numSamUseM, p1.kaiserBeta)
        val sumW3 = w3.sum()

        val (framesRaw, numFragments) = DspUtils.generateOverlappingFrames(p1.perOlf, data, numSamUseM)
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
            frequencyAxisZoom, p1.sigBwHz, p1.maxTh, sumW3,
            label = "phase1"
        )

        val globalFreqs = mutableListOf<Double>()

        if (isNoisySpectrum(peakPowers, p1.noiseMaxDiff, p1.noiseMinPeaks)) {
            Log.d(TAG, "phase1: spectrum flagged noisy (${peakPowers.size} peaks) → skipping")
            return globalFreqs
        }

        Log.d(TAG, "phase1: ${peakFrequencies.size} candidate peaks")


        for (nPeaks in peakFrequencies.indices) {
            val freq1 = peakFrequencies[nPeaks]
            val iqShifted = DspUtils.frequencyShift(data, bbSampleRate, -freq1)
            val decimated = DspUtils.lpfAndDownsample(
                p2.lpfOrder, p2.lpfCutoff, iqShifted, bbSampleRate, p2.requiredFs1Hz
            )

            val numSamP1 = (decimated.size * p2.numSamUseRatioP1).toInt()
            val zoomKP1 = decimated.size / numSamP1

            val w3P1 = DspUtils.kaiserWindow(numSamP1, p2.kaiserBetaP1)
            val sumW3P1 = w3P1.sum()

            val (framesP1Raw, numFragsP1) = DspUtils.generateOverlappingFrames(
                p2.perOlfP1, decimated, numSamP1
            )
            val framesP1 = framesP1Raw.map { frame ->
                Array(numSamP1) { j -> frame[j] * w3P1[j] }
            }

            val totalFftP1 = numSamP1 * zoomKP1
            val freqStepP1 = p2.requiredFs1Hz / totalFftP1
            val freqAxisP1 = DoubleArray(totalFftP1) { i ->
                -p2.requiredFs1Hz / 2.0 + i * freqStepP1
            }

            val (_, peakPowersP1, peakFreqsP1) = whAvgFftZoomPk(
                framesP1, zoomKP1, numSamP1, numFragsP1,
                freqAxisP1, p2.sigBwP1Hz, p2.maxThP1, sumW3P1,
                label = "phase2"
            )

            val noisy = isNoisySpectrum(peakPowersP1, p2.noiseMaxDiffP2, p2.noiseMinPeaksP2)
            if (!noisy) {
                val dcGuardHz = config.phase3.dcGuardHz
                for (idx in peakFreqsP1.indices) {
                    val offsetFromCenter = freq1 + peakFreqsP1[idx]
                    if (kotlin.math.abs(offsetFromCenter) < dcGuardHz) continue
                    globalFreqs.add(centerFreqHz + offsetFromCenter)
                }
            } else {
                Log.d(TAG, "phase2[$nPeaks]: noisy (${peakPowersP1.size} peaks) → skipping")
            }
        }

        Log.d(TAG, "phase2: accumulated ${globalFreqs.size} global frequencies")
        return globalFreqs
    }


    private fun measurePower(
        rawData: Array<Complex>,
        targetFrequencies: List<Double>
    ): List<PowerMeasurement> {
        val p3 = config.phase3
        val cm = config.channelMapping
        val results = mutableListOf<PowerMeasurement>()

        for (peakFreqAbs in targetFrequencies) {
            val peakFreqOffset = peakFreqAbs - centerFreqHz
            val iqShifted = DspUtils.frequencyShift(rawData, bbSampleRate, -peakFreqOffset)
            val iqZoomed = DspUtils.lpfAndDownsample(
                2, 0.03, iqShifted, bbSampleRate, p3.zoomFsPowerHz
            )

            val numSamPow = iqZoomed.size
            val zoomKPow = 1

            val win = DspUtils.kaiserWindow(numSamPow, p3.kaiserBetaPow)
            val sumW3Pow = win.sum()
            var winPow = 0.0
            for (w in win) winPow += w * w

            val (framesPowRaw, numFragsPow) = DspUtils.generateOverlappingFrames(
                0.0, iqZoomed, numSamPow
            )
            val framesPow = framesPowRaw.map { frame ->
                Array(numSamPow) { j -> frame[j] * win[j] }
            }

            val totalFftPow = numSamPow * zoomKPow
            val freqStepPow = p3.zoomFsPowerHz / totalFftPow
            val freqAxisPow = DoubleArray(totalFftPow) { i ->
                -p3.zoomFsPowerHz / 2.0 + i * freqStepPow
            }

            val (fftAvgPow, peakPowersPow, peakFreqsPow) = whAvgFftZoomPk(
                framesPow, zoomKPow, numSamPow, numFragsPow,
                freqAxisPow, p3.sigBwPowHz, p3.maxThPow, sumW3Pow,
                label = "phase3"
            )

            if (isNoisySpectrum(peakPowersPow, p3.noiseMaxDiffPow, p3.noiseMinPeaksPow)) {
                Log.d(TAG, "phase3[$peakFreqAbs Hz]: noisy → drop")
                continue
            }

            var finalCorrectedFreq = peakFreqAbs
            if (peakFreqsPow.isNotEmpty()) {
                finalCorrectedFreq = peakFreqAbs + peakFreqsPow[0]
                finalCorrectedFreq = mapToBand(finalCorrectedFreq, cm)
            }

            val fftSize = fftAvgPow.size
            val denominator = sqrt(p3.zoomFsPowerHz * winPow)

            val psd = DoubleArray(fftSize) { i ->
                val xa = fftAvgPow[i].abs()
                val xasd = 2.0 * xa / denominator
                xasd * xasd / 2.0
            }

            val df = if (freqAxisPow.size >= 2) freqAxisPow[1] - freqAxisPow[0] else 1.0
            val effectivePsd = if (fftSize <= freqAxisPow.size) psd
            else DoubleArray(freqAxisPow.size) { psd[it] }

            var powerWatts = 0.0
            for (i in freqAxisPow.indices) {
                if (freqAxisPow[i] >= -p3.priorKnowledgeBwHz / 2.0 &&
                    freqAxisPow[i] <= p3.priorKnowledgeBwHz / 2.0
                ) {
                    powerWatts += effectivePsd[i] * df
                }
            }

            if (powerWatts > 0) {
                val powerDbm = 10.0 * log10(powerWatts / 0.001) + p3.powerCalOffsetDb
                results.add(PowerMeasurement(finalCorrectedFreq, powerDbm))
            }
        }

        val best = LinkedHashMap<Double, PowerMeasurement>()
        for (m in results) {
            val prev = best[m.frequency]
            if (prev == null || m.powerDbm > prev.powerDbm) best[m.frequency] = m
        }
        results.clear()
        results.addAll(best.values)

        return results
    }


    private fun whAvgFftZoomPk(
        windowedFrames: List<Array<Complex>>,
        zoomK: Int,
        numSamples: Int,
        numFragments: Int,
        frequencyAxis: DoubleArray,
        sigBw: Double,
        maxTh: Double,
        sumW3: Double,
        label: String = ""
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

        val maxDb = xasDb.maxOrNull() ?: return ZoomPkResult(fftSum, emptyList(), emptyList())
        val threshold = 20.0 * log10(maxTh) + maxDb

        val freqResolution = if (frequencyAxis.size >= 2)
            frequencyAxis[1] - frequencyAxis[0] else 1.0
        val distance = round(sigBw / freqResolution).toInt()

        val effectiveDb = if (paddedSize <= frequencyAxis.size) xasDb
        else DoubleArray(frequencyAxis.size) { xasDb[it] }

        val locs = DspUtils.findPeaks(effectiveDb, threshold, distance)

        val peakPowers = locs.map { effectiveDb[it] }
        val peakFrequencies = locs.map { frequencyAxis[it] }

        Log.d(
            TAG,
            "whAvgFftZoomPk[$label]: framesUsed=$framesToUse maxDb=${"%.2f".format(maxDb)} " +
                    "thresh=${"%.2f".format(threshold)} dist=$distance peaks=${locs.size}"
        )

        return ZoomPkResult(fftSum, peakPowers, peakFrequencies)
    }

    private fun mapToBand(
        inputFrequency: Double,
        cm: ChannelMappingConfig
    ): Double {
        val channelIndex = round(
            (inputFrequency - cm.bandStartFreqHz) / cm.channelSpacingMapHz
        ) + 1.0
        return cm.bandStartFreqHz + (channelIndex - 1.0) * cm.channelSpacingMapHz
    }

    @Suppress("UNUSED_PARAMETER")
    private fun isNoisySpectrum(
        peakPowers: List<Double>,
        threshold: Double,
        minPeaks: Int
    ): Boolean {
        return peakPowers.size >= minPeaks
    }
}
