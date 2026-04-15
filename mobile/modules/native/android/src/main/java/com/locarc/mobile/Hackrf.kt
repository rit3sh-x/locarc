package com.locarc.mobile

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbRequest
import android.util.Log
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue

class Hackrf internal constructor(
    usbManager: UsbManager,
    val usbDevice: UsbDevice,
    queueSize: Int
) : Runnable {

    private val usbInterface: UsbInterface
    private val usbConnection: UsbDeviceConnection
    private val usbEndpointIN: UsbEndpoint
    private val usbEndpointOUT: UsbEndpoint

    @Volatile
    var transceiverMode = HACKRF_TRANSCEIVER_MODE_OFF
        private set

    private var usbThread: Thread? = null
    private val queue: ArrayBlockingQueue<ByteArray> = ArrayBlockingQueue(queueSize)
    private val bufferPool: ArrayBlockingQueue<ByteArray> = ArrayBlockingQueue(queueSize)

    private var transceiveStartTime: Long = 0
    @Volatile
    private var transceivePacketCounter: Long = 0

    private var packetSizeBytes: Int = DEFAULT_PACKET_SIZE_BYTES
    val packetSize: Int
        get() = packetSizeBytes

    init {
        Log.i(LOG_TAG, "Creating Hackrf instance from ${usbDevice.deviceName}")
        try {
            usbInterface = usbDevice.getInterface(0)
            usbEndpointIN = usbInterface.getEndpoint(0)
            usbEndpointOUT = usbInterface.getEndpoint(1)

            usbConnection = usbManager.openDevice(usbDevice)?.also {
                if (!it.claimInterface(usbInterface, true)) {
                    throw UsbException("Could not claim USB interface.")
                }
            } ?: throw UsbException("Could not open USB device connection.")

        } catch (e: Exception) {
            Log.e(LOG_TAG, "Failed to initialize HackRF USB device.", e)
            throw UsbException("Error: Couldn't open HackRF USB Device: ${e.message}")
        }
    }

    @Throws(IllegalStateException::class)
    fun setBufferSize(sizeInKB: Int) {
        if (transceiverMode != HACKRF_TRANSCEIVER_MODE_OFF) {
            throw IllegalStateException("Buffer size cannot be changed while the transceiver is active.")
        }
        val newSizeInBytes = sizeInKB * 1024
        if (newSizeInBytes > 0) {
            packetSizeBytes = newSizeInBytes
            bufferPool.clear()
            Log.d(LOG_TAG, "Set USB packet size to $packetSizeBytes bytes ($sizeInKB KB)")
        } else {
            Log.w(LOG_TAG, "Invalid buffer size ($sizeInKB KB), using default.")
            packetSizeBytes = DEFAULT_PACKET_SIZE_BYTES
        }
    }

    @Throws(UsbException::class)
    fun startRX(): ArrayBlockingQueue<ByteArray> {
        val previous = usbThread
        if (previous != null && previous.isAlive) {
            Log.w(LOG_TAG, "startRX: waiting for previous receive loop to terminate")
            try {
                if (transceiverMode != HACKRF_TRANSCEIVER_MODE_OFF) {
                    setTransceiverMode(HACKRF_TRANSCEIVER_MODE_OFF)
                }
                queue.poll()
                previous.join(JOIN_TIMEOUT_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (previous.isAlive) {
                throw UsbException("startRX: previous receive loop did not terminate in time")
            }
        }
        usbThread = null
        queue.clear()
        setTransceiverMode(HACKRF_TRANSCEIVER_MODE_RECEIVE)
        usbThread = Thread(this).apply { start() }
        transceiveStartTime = System.currentTimeMillis()
        transceivePacketCounter = 0
        return queue
    }

    @Throws(UsbException::class)
    fun stop() {
        if (transceiverMode != HACKRF_TRANSCEIVER_MODE_OFF) {
            setTransceiverMode(HACKRF_TRANSCEIVER_MODE_OFF)
        }
        val t = usbThread
        if (t != null && t.isAlive) {
            queue.poll()
            try {
                t.join(JOIN_TIMEOUT_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (t.isAlive) {
                Log.w(LOG_TAG, "stop: receive loop did not terminate within ${JOIN_TIMEOUT_MS}ms")
            }
        }
        usbThread = null
    }

    fun close() {
        try {
            stop()
            usbConnection.releaseInterface(usbInterface)
            usbConnection.close()
            Log.i(LOG_TAG, "HackRF USB connection closed.")
        } catch (e: Exception) {
            Log.e(LOG_TAG, "Error while closing HackRF.", e)
        }
    }

    @Throws(UsbException::class)
    fun setSampleRate(sampRate: Int, divider: Int): Boolean {
        val buffer = ByteArrayOutputStream().use {
            it.write(intToByteArray(sampRate))
            it.write(intToByteArray(divider))
            it.toByteArray()
        }
        val len = sendUsbRequest(
            UsbConstants.USB_DIR_OUT,
            HACKRF_VENDOR_REQUEST_SAMPLE_RATE_SET,
            buffer = buffer
        )
        if (len != 8) throw UsbException("setSampleRate: USB transfer failed.")
        return true
    }

    @Throws(UsbException::class)
    fun setBasebandFilterBandwidth(bandwidth: Int): Boolean {
        val len = sendUsbRequest(
            UsbConstants.USB_DIR_OUT,
            HACKRF_VENDOR_REQUEST_BASEBAND_FILTER_BANDWIDTH_SET,
            value = bandwidth and 0xffff,
            index = (bandwidth shr 16) and 0xffff
        )
        if (len != 0) {
            throw UsbException("setBasebandFilterBandwidth: USB transfer failed. Result: $len")
        }
        return true
    }

    @Throws(UsbException::class)
    fun setFrequency(frequency: Long): Boolean {
        val mhz = (frequency / 1_000_000L).toInt()
        val hz = (frequency % 1_000_000L).toInt()
        Log.d(LOG_TAG, "Tuning HackRF to $mhz.$hz MHz...")

        val buffer = ByteArrayOutputStream().use {
            it.write(intToByteArray(mhz))
            it.write(intToByteArray(hz))
            it.toByteArray()
        }

        val len = sendUsbRequest(
            UsbConstants.USB_DIR_OUT,
            HACKRF_VENDOR_REQUEST_SET_FREQ,
            buffer = buffer
        )
        if (len != 8) throw UsbException("setFrequency: USB transfer failed.")
        return true
    }

    @Throws(UsbException::class)
    fun setLnaGain(gainDb: Int): Boolean {
        val clamped = gainDb.coerceIn(0, 40)
        val quantized = clamped - (clamped % 8)
        if (quantized != gainDb) {
            Log.w(LOG_TAG, "setLnaGain: requested $gainDb dB, using $quantized dB (must be 0..40 in steps of 8)")
        }
        val retVal = ByteArray(1)
        val len = sendUsbRequest(
            UsbConstants.USB_DIR_IN,
            HACKRF_VENDOR_REQUEST_SET_LNA_GAIN,
            value = 0,
            index = quantized,
            buffer = retVal
        )
        if (len != 1) {
            throw UsbException("setLnaGain: USB transfer failed. Result: $len")
        }
        if (retVal[0] == 0.toByte()) {
            Log.e(LOG_TAG, "setLnaGain: HackRF returned with an error!")
            return false
        }
        return true
    }

    @Throws(UsbException::class)
    fun setVgaGain(gainDb: Int): Boolean {
        val clamped = gainDb.coerceIn(0, 62)
        val quantized = clamped - (clamped % 2)
        if (quantized != gainDb) {
            Log.w(LOG_TAG, "setVgaGain: requested $gainDb dB, using $quantized dB (must be 0..62 in steps of 2)")
        }
        val retVal = ByteArray(1)
        val len = sendUsbRequest(
            UsbConstants.USB_DIR_IN,
            HACKRF_VENDOR_REQUEST_SET_VGA_GAIN,
            value = 0,
            index = quantized,
            buffer = retVal
        )

        if (len != 1) {
            throw UsbException("setVgaGain: USB transfer failed. Result: $len")
        }

        if (retVal[0] == 0.toByte()) {
            Log.e(LOG_TAG, "setVgaGain: HackRF returned with an error!")
            return false
        }
        return true
    }

    fun getBufferFromBufferPool(): ByteArray {
        return bufferPool.poll() ?: ByteArray(packetSize)
    }

    fun returnBufferToBufferPool(buffer: ByteArray) {
        if (buffer.size == packetSize) {
            bufferPool.offer(buffer)
        } else {
            Log.w(LOG_TAG, "returnBuffer: Buffer has wrong size and was ignored.")
        }
    }

    override fun run() {
        when (transceiverMode) {
            HACKRF_TRANSCEIVER_MODE_RECEIVE -> receiveLoop()
            HACKRF_TRANSCEIVER_MODE_TRANSMIT -> transmitLoop()
        }
    }

    private fun receiveLoop() {
        val usbRequests = Array(NUM_USB_REQUESTS) { UsbRequest() }

        try {
            usbRequests.forEach { request ->
                val byteArray = getBufferFromBufferPool()
                val buffer = ByteBuffer.wrap(byteArray)
                buffer.clear()

                request.initialize(usbConnection, usbEndpointIN)
                request.clientData = buffer

                val queued = request.queue(buffer)
                if (!queued) {
                    Log.e(LOG_TAG, "receiveLoop: Couldn't queue initial USB Request.")
                    stop()
                    return
                }
            }

            while (transceiverMode == HACKRF_TRANSCEIVER_MODE_RECEIVE) {
                val completedRequest = usbConnection.requestWait()
                if (completedRequest == null) {
                    Log.e(LOG_TAG, "receiveLoop: requestWait returned null")
                    break
                }

                if (completedRequest.endpoint != usbEndpointIN) {
                    Log.w(LOG_TAG, "receiveLoop: Got request for wrong endpoint")
                    continue
                }

                val receivedBuffer = completedRequest.clientData as? ByteBuffer
                if (receivedBuffer == null) {
                    Log.e(LOG_TAG, "receiveLoop: clientData is null or not ByteBuffer")
                    break
                }

                if (!queue.offer(receivedBuffer.array())) {
                    Log.e(LOG_TAG, "receiveLoop: Queue is full. Stopping reception.")
                    break
                }

                val newByteArray = getBufferFromBufferPool()
                val newBuffer = ByteBuffer.wrap(newByteArray)
                newBuffer.clear()

                completedRequest.clientData = newBuffer

                val requeued = completedRequest.queue(newBuffer)
                if (!requeued) {
                    Log.e(LOG_TAG, "receiveLoop: Couldn't re-queue USB Request.")
                    break
                }
            }
        } catch (e: Exception) {
            Log.e(LOG_TAG, "receiveLoop: USB Error!", e)
        } finally {
            Log.d(LOG_TAG, "receiveLoop: Cancelling all USB requests...")
            usbRequests.forEach { it.cancel() }
            if (transceiverMode == HACKRF_TRANSCEIVER_MODE_RECEIVE) {
                try { stop() } catch (_: UsbException) { }
            }
            Log.d(LOG_TAG, "receiveLoop: Finished.")
        }
    }

    private fun transmitLoop() {
        val usbRequest = UsbRequest()
        try {
            usbRequest.initialize(usbConnection, usbEndpointOUT)

            while (transceiverMode == HACKRF_TRANSCEIVER_MODE_TRANSMIT) {
                val bufferToTransmit = queue.take()
                val byteBuffer = ByteBuffer.wrap(bufferToTransmit)

                usbRequest.clientData = byteBuffer
                usbRequest.queue(byteBuffer)
                transceivePacketCounter++

                val completedRequest = usbConnection.requestWait()
                if (completedRequest == null || completedRequest != usbRequest) {
                    Log.e(LOG_TAG, "transmitLoop: requestWait failed.")
                    break
                }
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            Log.d(LOG_TAG, "transmitLoop interrupted, shutting down.")
        } catch (e: Exception) {
            Log.e(LOG_TAG, "transmitLoop: USB Error!", e)
        } finally {
            usbRequest.cancel()
            if (transceiverMode == HACKRF_TRANSCEIVER_MODE_TRANSMIT) {
                try { stop() } catch (_: UsbException) { }
            }
        }
    }

    @Throws(UsbException::class)
    private fun setTransceiverMode(mode: Int) {
        if (mode !in 0..2) {
            throw IllegalArgumentException("Invalid Transceiver Mode: $mode")
        }
        sendUsbRequest(
            endpoint = UsbConstants.USB_DIR_OUT,
            request = HACKRF_VENDOR_REQUEST_SET_TRANSCEIVER_MODE,
            value = mode
        )
        this.transceiverMode = mode
    }

    @Throws(UsbException::class)
    private fun sendUsbRequest(
        endpoint: Int,
        request: Int,
        value: Int = 0,
        index: Int = 0,
        buffer: ByteArray? = null
    ): Int {
        val length = buffer?.size ?: 0
        return usbConnection.controlTransfer(
            endpoint or UsbConstants.USB_TYPE_VENDOR,
            request,
            value,
            index,
            buffer,
            length,
            1000
        )
    }

    private fun intToByteArray(i: Int): ByteArray = byteArrayOf(
        (i and 0xff).toByte(),
        ((i shr 8) and 0xff).toByte(),
        ((i shr 16) and 0xff).toByte(),
        ((i shr 24) and 0xff).toByte()
    )

    companion object {
        private const val LOG_TAG = "hackrf_android"
        private const val NUM_USB_REQUESTS = 4
        private const val DEFAULT_PACKET_SIZE_BYTES = 1024 * 256
        private const val JOIN_TIMEOUT_MS = 2000L

        const val HACKRF_TRANSCEIVER_MODE_OFF = 0
        const val HACKRF_TRANSCEIVER_MODE_RECEIVE = 1
        const val HACKRF_TRANSCEIVER_MODE_TRANSMIT = 2

        private const val HACKRF_VENDOR_REQUEST_SET_TRANSCEIVER_MODE = 1
        private const val HACKRF_VENDOR_REQUEST_SAMPLE_RATE_SET = 6
        private const val HACKRF_VENDOR_REQUEST_BASEBAND_FILTER_BANDWIDTH_SET = 7
        private const val HACKRF_VENDOR_REQUEST_SET_FREQ = 16
        private const val HACKRF_VENDOR_REQUEST_SET_LNA_GAIN = 19
        private const val HACKRF_VENDOR_REQUEST_SET_VGA_GAIN = 20

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
