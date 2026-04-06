package com.locarc.mobile.algorithms

data class Phase1Config(
    val sigBwHz: Double = 200_000.0,
    val chSpacingHz: Double = 10_000.0,
    val perOlf: Double = 0.0,
    val numSamUseRatio: Double = 0.5,
    val maxTh: Double = 0.09,
    val kaiserBeta: Double = 36.0,
    val highpassOrder: Int = 1,
    val highpassCutoff: Double = 0.0001,
    val noiseMinPeaks: Int = 10,
    val noiseMaxDiff: Double = 10.0
)

data class Phase2Config(
    val requiredFs1Hz: Double = 200_000.0,
    val sigBwP1Hz: Double = 10_000.0,
    val perOlfP1: Double = 0.0,
    val numSamUseRatioP1: Double = 0.5,
    val maxThP1: Double = 0.4,
    val kaiserBetaP1: Double = 60.0,
    val lpfOrder: Int = 2,
    val lpfCutoff: Double = 0.03,
    val noiseMinPeaksP2: Int = 5,
    val noiseMaxDiffP2: Double = 10.0
)

data class Phase3Config(
    val priorKnowledgeBwHz: Double = 10_000.0,
    val zoomFsPowerHz: Double = 50_000.0,
    val sigBwPowHz: Double = 5_000.0,
    val maxThPow: Double = 0.4,
    val kaiserBetaPow: Double = 60.0,
    val noiseMinPeaksPow: Int = 2,
    val noiseMaxDiffPow: Double = 10.0
)

data class ChannelMappingConfig(
    val bandStartFreqHz: Double = 300_000_000.0,
    val bandEndFreqHz: Double = 500_000_000.0,
    val channelSpacingMapHz: Double = 12_500.0
)

data class AlgoConfig(
    val phase1: Phase1Config = Phase1Config(),
    val phase2: Phase2Config = Phase2Config(),
    val phase3: Phase3Config = Phase3Config(),
    val channelMapping: ChannelMappingConfig = ChannelMappingConfig()
) {
    companion object {
        fun fromMap(map: Map<String, Any>): AlgoConfig {
            val p1 = (map["phase1"] as? Map<*, *>)?.let { m ->
                Phase1Config(
                    sigBwHz = (m["sigBwHz"] as? Number)?.toDouble() ?: 200_000.0,
                    chSpacingHz = (m["chSpacingHz"] as? Number)?.toDouble() ?: 10_000.0,
                    perOlf = (m["perOlf"] as? Number)?.toDouble() ?: 0.0,
                    numSamUseRatio = (m["numSamUseRatio"] as? Number)?.toDouble() ?: 0.5,
                    maxTh = (m["maxTh"] as? Number)?.toDouble() ?: 0.09,
                    kaiserBeta = (m["kaiserBeta"] as? Number)?.toDouble() ?: 36.0,
                    highpassOrder = (m["highpassOrder"] as? Number)?.toInt() ?: 1,
                    highpassCutoff = (m["highpassCutoff"] as? Number)?.toDouble() ?: 0.0001,
                    noiseMinPeaks = (m["noiseMinPeaks"] as? Number)?.toInt() ?: 10,
                    noiseMaxDiff = (m["noiseMaxDiff"] as? Number)?.toDouble() ?: 10.0
                )
            } ?: Phase1Config()

            val p2 = (map["phase2"] as? Map<*, *>)?.let { m ->
                Phase2Config(
                    requiredFs1Hz = (m["requiredFs1Hz"] as? Number)?.toDouble() ?: 200_000.0,
                    sigBwP1Hz = (m["sigBwP1Hz"] as? Number)?.toDouble() ?: 10_000.0,
                    perOlfP1 = (m["perOlfP1"] as? Number)?.toDouble() ?: 0.0,
                    numSamUseRatioP1 = (m["numSamUseRatioP1"] as? Number)?.toDouble() ?: 0.5,
                    maxThP1 = (m["maxThP1"] as? Number)?.toDouble() ?: 0.4,
                    kaiserBetaP1 = (m["kaiserBetaP1"] as? Number)?.toDouble() ?: 60.0,
                    lpfOrder = (m["lpfOrder"] as? Number)?.toInt() ?: 2,
                    lpfCutoff = (m["lpfCutoff"] as? Number)?.toDouble() ?: 0.03,
                    noiseMinPeaksP2 = (m["noiseMinPeaksP2"] as? Number)?.toInt() ?: 5,
                    noiseMaxDiffP2 = (m["noiseMaxDiffP2"] as? Number)?.toDouble() ?: 10.0
                )
            } ?: Phase2Config()

            val p3 = (map["phase3"] as? Map<*, *>)?.let { m ->
                Phase3Config(
                    priorKnowledgeBwHz = (m["priorKnowledgeBwHz"] as? Number)?.toDouble() ?: 10_000.0,
                    zoomFsPowerHz = (m["zoomFsPowerHz"] as? Number)?.toDouble() ?: 50_000.0,
                    sigBwPowHz = (m["sigBwPowHz"] as? Number)?.toDouble() ?: 5_000.0,
                    maxThPow = (m["maxThPow"] as? Number)?.toDouble() ?: 0.4,
                    kaiserBetaPow = (m["kaiserBetaPow"] as? Number)?.toDouble() ?: 60.0,
                    noiseMinPeaksPow = (m["noiseMinPeaksPow"] as? Number)?.toInt() ?: 2,
                    noiseMaxDiffPow = (m["noiseMaxDiffPow"] as? Number)?.toDouble() ?: 10.0
                )
            } ?: Phase3Config()

            val cm = (map["channelMapping"] as? Map<*, *>)?.let { m ->
                ChannelMappingConfig(
                    bandStartFreqHz = (m["bandStartFreqHz"] as? Number)?.toDouble() ?: 300_000_000.0,
                    bandEndFreqHz = (m["bandEndFreqHz"] as? Number)?.toDouble() ?: 500_000_000.0,
                    channelSpacingMapHz = (m["channelSpacingMapHz"] as? Number)?.toDouble() ?: 12_500.0
                )
            } ?: ChannelMappingConfig()

            return AlgoConfig(phase1 = p1, phase2 = p2, phase3 = p3, channelMapping = cm)
        }
    }
}
