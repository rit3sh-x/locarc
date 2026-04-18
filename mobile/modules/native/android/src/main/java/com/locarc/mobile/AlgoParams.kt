package com.locarc.mobile

object AlgoParams {

    const val DOUBLES_LEN = 21
    const val INTS_LEN = 4

    data class Packed(val doubles: DoubleArray, val ints: IntArray)

    fun fromMap(map: Map<String, Any>): Packed {
        val p1 = requireSection(map, "phase1")
        val p2 = requireSection(map, "phase2")
        val cm = requireSection(map, "channelMapping")

        val doubles = DoubleArray(DOUBLES_LEN)
        doubles[0] = requireDouble(p1, "phase1.sigBwHz")
        doubles[1] = requireDouble(p1, "phase1.perOlf")
        doubles[2] = requireDouble(p1, "phase1.numSamUseRatio")
        doubles[3] = requireDouble(p1, "phase1.maxTh")
        doubles[4] = requireDouble(p1, "phase1.kaiserBeta")
        doubles[5] = requireDouble(p1, "phase1.highpassCutoff")
        doubles[6] = requireDouble(p1, "phase1.noiseMaxDiff")
        doubles[7]  = requireDouble(p2, "phase2.requiredFs1Hz")
        doubles[8]  = requireDouble(p2, "phase2.chSpacingHz")
        doubles[9]  = requireDouble(p2, "phase2.perOlfP1")
        doubles[10] = requireDouble(p2, "phase2.numSamUseRatioP1")
        doubles[11] = requireDouble(p2, "phase2.maxThP1")
        doubles[12] = requireDouble(p2, "phase2.kaiserBetaP1")
        doubles[13] = requireDouble(p2, "phase2.lpfCutoff")
        doubles[14] = requireDouble(p2, "phase2.noiseMaxDiffP2")
        doubles[15] = requireDouble(p2, "phase2.dcGuardHz")
        doubles[16] = requireDouble(cm, "channelMapping.bandStartFreqHz")
        doubles[17] = requireDouble(cm, "channelMapping.bandEndFreqHz")
        doubles[18] = requireDouble(cm, "channelMapping.channelSpacingMapHz")
        doubles[19] = requireDouble(cm, "channelMapping.powerCalOffsetDb")
        doubles[20] = requireDouble(cm, "channelMapping.sidelobeDedupHz")

        val ints = IntArray(INTS_LEN)
        ints[0] = requireInt(p1, "phase1.highpassOrder")
        ints[1] = requireInt(p1, "phase1.noiseMinPeaks")
        ints[2] = requireInt(p2, "phase2.lpfOrder")
        ints[3] = requireInt(p2, "phase2.noiseMinPeaksP2")

        return Packed(doubles, ints)
    }

    private fun requireSection(map: Map<String, Any>, key: String): Map<*, *> =
        (map[key] as? Map<*, *>) ?: throw IllegalArgumentException("algo.$key section is required")

    private fun requireDouble(m: Map<*, *>, path: String): Double {
        val key = path.substringAfterLast('.')
        val v = m[key] as? Number
            ?: throw IllegalArgumentException("algo.$path is required (number)")
        return v.toDouble()
    }

    private fun requireInt(m: Map<*, *>, path: String): Int {
        val key = path.substringAfterLast('.')
        val v = m[key] as? Number
            ?: throw IllegalArgumentException("algo.$path is required (int)")
        return v.toInt()
    }
}
