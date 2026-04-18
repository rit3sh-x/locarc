package com.locarc.mobile

object HackrfNative {
    init {
        System.loadLibrary("locarc_hackrf")
    }

    external fun nativeOpen(fd: Int): Long

    external fun nativeClose(handle: Long)

    external fun nativeSetSampleRate(handle: Long, hz: Int): Int
    external fun nativeSetBasebandFilter(handle: Long, hz: Int): Int
    external fun nativeSetFrequency(handle: Long, hz: Long): Int
    external fun nativeSetLnaGain(handle: Long, db: Int): Int
    external fun nativeSetVgaGain(handle: Long, db: Int): Int
    external fun nativeSetAmpEnable(handle: Long, enable: Boolean): Int

    external fun nativeStartRx(handle: Long): Int
    external fun nativeStopRx(handle: Long): Int

    external fun nativeReadSamples(
        handle: Long,
        dst: ByteArray,
        offset: Int,
        len: Int,
        timeoutMs: Int
    ): Int

    external fun nativeRunFullScan(
        handle: Long,
        minFreqHz: Long,
        maxFreqHz: Long,
        sampleRateHz: Int,
        lnaGainDb: Int,
        vgaGainDb: Int,
        perStepBytes: Int,
        algoDoubles: DoubleArray,
        algoInts: IntArray
    ): DoubleArray

    external fun nativeCancelScan()
}

