package com.locarc.mobile

data class ScanSettings(
    val minFrequencyHz: Long,
    val maxFrequencyHz: Long,
    val sampleRateHz: Int,
    val lnaGainDb: Int,
    val vgaGainDb: Int,
    val bufferSizeKb: Int
)
