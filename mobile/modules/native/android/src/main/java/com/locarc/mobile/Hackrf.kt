package com.locarc.mobile

import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.util.Log

class Hackrf private constructor(
    val usbDevice: UsbDevice,
    private val connection: UsbDeviceConnection,
    private var handle_: Long
) {
    val handle: Long get() = handle_

    @Volatile
    var transceiverMode: Int = HACKRF_TRANSCEIVER_MODE_OFF
        private set

    val packetSize: Int = PACKET_SIZE_BYTES

    @Throws(UsbException::class)
    fun setSampleRate(sampRate: Int, divider: Int): Boolean {
        checkHandle()
        val rc = HackrfNative.nativeSetSampleRate(handle, sampRate)
        if (rc != 8) throw UsbException("setSampleRate failed (rc=$rc)")
        return true
    }

    @Throws(UsbException::class)
    fun setBasebandFilterBandwidth(bandwidth: Int): Boolean {
        checkHandle()
        val rc = HackrfNative.nativeSetBasebandFilter(handle, bandwidth)
        if (rc != 0) throw UsbException("setBasebandFilterBandwidth failed (rc=$rc)")
        return true
    }

    @Throws(UsbException::class)
    fun setFrequency(frequency: Long): Boolean {
        checkHandle()
        val rc = HackrfNative.nativeSetFrequency(handle, frequency)
        if (rc != 8) throw UsbException("setFrequency failed (rc=$rc)")
        return true
    }

    @Throws(UsbException::class)
    fun setLnaGain(gainDb: Int): Boolean {
        checkHandle()
        val rc = HackrfNative.nativeSetLnaGain(handle, gainDb)
        if (rc < 0) throw UsbException("setLnaGain failed (rc=$rc)")
        return rc > 0
    }

    @Throws(UsbException::class)
    fun setVgaGain(gainDb: Int): Boolean {
        checkHandle()
        val rc = HackrfNative.nativeSetVgaGain(handle, gainDb)
        if (rc < 0) throw UsbException("setVgaGain failed (rc=$rc)")
        return rc > 0
    }

    @Throws(UsbException::class)
    fun setAmp(enabled: Boolean): Boolean {
        checkHandle()
        val rc = HackrfNative.nativeSetAmpEnable(handle, enabled)
        if (rc != 0) throw UsbException("setAmp failed (rc=$rc)")
        return true
    }

    fun setBufferSize(@Suppress("UNUSED_PARAMETER") sizeInKB: Int) = Unit

    @Throws(UsbException::class)
    fun startRx() {
        checkHandle()
        val rc = HackrfNative.nativeStartRx(handle)
        if (rc != 0) throw UsbException("startRx failed (rc=$rc)")
        transceiverMode = HACKRF_TRANSCEIVER_MODE_RECEIVE
    }

    @Throws(UsbException::class)
    fun stop() {
        if (handle == 0L) return
        val rc = HackrfNative.nativeStopRx(handle)
        if (rc != 0) Log.w(TAG, "stopRx rc=$rc")
        transceiverMode = HACKRF_TRANSCEIVER_MODE_OFF
    }

    @Throws(UsbException::class)
    fun readSamples(totalBytes: Int, timeoutMs: Int = 5000): ByteArray {
        checkHandle()
        val out = ByteArray(totalBytes)
        val filled = HackrfNative.nativeReadSamples(handle, out, 0, totalBytes, timeoutMs)
        if (filled < totalBytes) {
            throw UsbException("readSamples short: $filled / $totalBytes")
        }
        return out
    }

    fun close() {
        if (handle_ != 0L) {
            HackrfNative.nativeClose(handle_)
            handle_ = 0L
        }
        try { connection.close() } catch (_: Exception) {}
    }

    fun reset(): Int {
        if (handle_ == 0L) return -1
        val rc = HackrfNative.nativeReset(handle_)
        handle_ = 0L
        transceiverMode = HACKRF_TRANSCEIVER_MODE_OFF
        try { Thread.sleep(POST_RESET_FD_GRACE_MS) } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        try { connection.close() } catch (_: Exception) {}
        Log.w(TAG, "Hackrf reset sent (rc=$rc) — device rebooting, handle closed")
        return rc
    }

    private fun checkHandle() {
        if (handle == 0L) throw UsbException("Hackrf handle is closed")
    }

    companion object {
        private const val TAG = "Hackrf"
        private const val PACKET_SIZE_BYTES = 256 * 1024
        private const val POST_RESET_FD_GRACE_MS = 200L
        private const val OPEN_RETRY_DELAY_MS = 1000L

        const val HACKRF_TRANSCEIVER_MODE_OFF = 0
        const val HACKRF_TRANSCEIVER_MODE_RECEIVE = 1
        const val HACKRF_TRANSCEIVER_MODE_TRANSMIT = 2

        @Throws(UsbException::class)
        fun open(usbManager: UsbManager, device: UsbDevice): Hackrf {
            var conn = usbManager.openDevice(device)
            if (conn == null) {
                Log.w(TAG, "openDevice null — bus may be re-enumerating, retrying after ${OPEN_RETRY_DELAY_MS}ms")
                try { Thread.sleep(OPEN_RETRY_DELAY_MS) } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
                conn = usbManager.openDevice(device)
            }
            if (conn == null) {
                throw UsbException("openDevice returned null — device gone?")
            }
            val fd = conn.fileDescriptor
            if (fd < 0) {
                conn.close()
                throw UsbException("UsbDeviceConnection.fileDescriptor = $fd")
            }
            val h = HackrfNative.nativeOpen(fd)
            if (h == 0L) {
                conn.close()
                throw UsbException("native open failed (libusb_wrap_sys_device/claim)")
            }
            Log.i(TAG, "HackRF opened fd=$fd handle=0x${h.toString(16)}")
            return Hackrf(device, conn, h)
        }

        private val SUPPORTED_BASEBAND_BANDWIDTHS = intArrayOf(
            1_750_000, 2_500_000, 3_500_000, 5_000_000, 5_500_000,
            6_000_000, 7_000_000, 8_000_000, 9_000_000, 10_000_000,
            12_000_000, 14_000_000, 15_000_000, 20_000_000, 24_000_000, 28_000_000
        )

        fun computeBasebandFilterBandwidth(sampRate: Int): Int {
            var bandwidth = SUPPORTED_BASEBAND_BANDWIDTHS[0]
            for (candidate in SUPPORTED_BASEBAND_BANDWIDTHS) {
                if (sampRate < candidate) break
                bandwidth = candidate
            }
            return bandwidth
        }
    }
}
