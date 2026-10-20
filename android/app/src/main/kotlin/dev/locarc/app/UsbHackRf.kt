package dev.locarc.app

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbRequest
import dev.locarc.core.DeviceInfo
import dev.locarc.core.Fault
import dev.locarc.core.HackRfDriver
import dev.locarc.core.HackRfException
import dev.locarc.core.SweepPlan
import dev.locarc.core.Transfer
import dev.locarc.core.Tuning
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeoutException
import kotlin.math.ceil

/**
 * Pure-Kotlin HackRF One driver over Android's USB host API: libhackrf's vendor requests plus
 * 8 queued 256 KiB bulk reads on a dedicated reader thread. No NDK, no libusb.
 */
class UsbHackRf(
    private val usb: UsbManager,
) : HackRfDriver {
    private var conn: UsbDeviceConnection? = null
    private var intf: UsbInterface? = null
    private var rx: UsbEndpoint? = null
    private var reader: Thread? = null
    private val transfers = Channel<Transfer>(QUEUED)
    private val pool = ArrayBlockingQueue<ByteArray>(POOL)

    @Volatile private var gone = false

    @Volatile private var streaming = false
    private var last: ByteArray? = null

    init {
        repeat(POOL) { pool.add(ByteArray(REQUEST_BYTES)) }
    }

    override suspend fun open(): DeviceInfo =
        withContext(Dispatchers.IO) {
            val device =
                usb.deviceList.values.firstOrNull { it.vendorId == VID && it.productId == PID }
                    ?: throw HackRfException(Fault.DETACHED, "no HackRF on the bus")
            if (!usb.hasPermission(device)) throw HackRfException(Fault.PERMISSION_DENIED, "USB permission not granted")
            val c = usb.openDevice(device) ?: throw HackRfException(Fault.OPEN_FAILED, "openDevice returned null")
            val i = device.getInterface(0)
            if (!c.claimInterface(i, true)) {
                c.close()
                throw HackRfException(Fault.OPEN_FAILED, "claimInterface failed")
            }
            conn = c
            intf = i
            rx =
                (0 until i.endpointCount).map(i::getEndpoint).first {
                    it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == UsbConstants.USB_DIR_IN
                }
            gone = false
            val raw = c.rawDescriptors
            val usbApi = (raw[12].toInt() and 0xff) or ((raw[13].toInt() and 0xff) shl 8)
            val serial =
                runCatching {
                    val b = ByteBuffer.wrap(input(18, 24)).order(ByteOrder.LITTLE_ENDIAN)
                    (2 until 6).joinToString("") { "%08x".format(b.getInt(it * 4)) }
                }.getOrDefault("unknown")
            DeviceInfo(input(14, 1)[0].toInt() and 0xff, String(input(15, 255)).trimEnd('\u0000'), serial, usbApi)
        }

    override suspend fun configure(
        t: Tuning,
        sampleRate: Int,
    ) = io {
        out(6, data = le32(sampleRate, 1))
        val bw = FILTERS.lastOrNull { it <= sampleRate * 3L / 4 } ?: FILTERS[0]
        out(7, bw and 0xffff, bw ushr 16)
        check(input(19, 1, index = t.lnaDb and 7.inv())[0].toInt() != 0) { "LNA gain ${t.lnaDb} rejected" }
        check(input(20, 1, index = t.vgaDb and 1.inv())[0].toInt() != 0) { "VGA gain ${t.vgaDb} rejected" }
        out(17, if (t.amp) 1 else 0)
    }

    override suspend fun startSweep(plan: SweepPlan) =
        io {
            stopStream()
            // libhackrf takes at most 10 ranges, in whole MHz, each a multiple of the 20 MHz step.
            val ranges = mergeRanges(plan.segments.map { (it.startHz / 1_000_000).toInt() to ceil(it.endHz / 1e6).toInt() }, MAX_RANGES)
            val data = ByteBuffer.allocate(9 + 4 * ranges.size).order(ByteOrder.LITTLE_ENDIAN)
            data.putInt(SweepPlan.TUNE_HZ.toInt())
            data.putInt(TUNE_OFFSET.toInt())
            data.put(INTERLEAVED)
            for ((lo, hi) in ranges) {
                val steps = ceil((hi - lo) / 20.0).toInt().coerceAtLeast(1)
                data.putShort(lo.toShort())
                data.putShort((lo + steps * 20).toShort())
            }
            out(26, BYTES_PER_TUNE and 0xffff, BYTES_PER_TUNE ushr 16, data.array())
            out(1, MODE_RX_SWEEP)
            startStream()
        }

    override suspend fun startReceive(centerHz: Long) =
        io {
            stopStream()
            val mhz = (centerHz / 1_000_000).toInt()
            out(16, data = le32(mhz, (centerHz - mhz * 1_000_000L).toInt()))
            out(1, MODE_RX)
            startStream()
        }

    override suspend fun read(): Transfer? {
        last?.let { pool.offer(it) }
        last = null
        if (gone) throw HackRfException(Fault.DETACHED, "requestWait returned null")
        val t =
            withTimeoutOrNull(READ_TIMEOUT_MS) { transfers.receive() }
                ?: return null.also { if (gone) throw HackRfException(Fault.DETACHED, "device gone") }
        last = t.data
        return t
    }

    override suspend fun stop() =
        io {
            stopStream()
            runCatching { out(1, MODE_OFF) }
            Unit
        }

    override suspend fun close() =
        io {
            stopStream()
            runCatching { out(1, MODE_OFF) }
            intf?.let { conn?.releaseInterface(it) }
            conn?.close()
            conn = null
        }

    override suspend fun reset() =
        io {
            stopStream()
            runCatching { out(30) }
            conn?.close()
            conn = null
        }

    private suspend fun <T> io(block: () -> T): T =
        withContext(Dispatchers.IO) {
            try {
                block()
            } catch (e: HackRfException) {
                throw e
            } catch (e: Exception) {
                throw HackRfException(if (gone || conn == null) Fault.DETACHED else Fault.TUNE_FAILED, e.message ?: "USB error")
            }
        }

    private fun startStream() {
        val c = conn ?: throw HackRfException(Fault.DETACHED, "not open")
        val ep = rx ?: throw HackRfException(Fault.DETACHED, "not open")
        streaming = true
        reader =
            Thread({
                val requests =
                    List(QUEUED) {
                        UsbRequest().apply {
                            check(initialize(c, ep)) { "UsbRequest.initialize failed" }
                            clientData = ByteBuffer.allocateDirect(REQUEST_BYTES)
                        }
                    }
                try {
                    requests.forEach { check(it.queue(it.clientData as ByteBuffer)) { "queue failed" } }
                    while (streaming) {
                        // A failed read is the first sign of a detach: don't wait for the broadcast.
                        val r =
                            try {
                                c.requestWait(REQUEST_TIMEOUT_MS)
                            } catch (_: TimeoutException) {
                                continue
                            } ?: break
                        val b = r.clientData as ByteBuffer
                        val n = b.position()
                        b.flip()
                        // A slow consumer drops whole transfers rather than stalling the USB queue.
                        pool.poll()?.let { buf ->
                            b.get(buf, 0, n)
                            if (!transfers.trySend(Transfer(buf, n)).isSuccess) pool.offer(buf)
                        }
                        b.clear()
                        if (!r.queue(b)) break
                    }
                } catch (_: Exception) {
                } finally {
                    if (streaming) gone = true
                    // Cancel, reap, then close: the order a clean detach needs.
                    requests.forEach { it.cancel() }
                    repeat(requests.size) { runCatching { c.requestWait(50) } }
                    requests.forEach { it.close() }
                }
            }, "hackrf-reader").also {
                it.priority = Thread.MAX_PRIORITY
                it.start()
            }
    }

    private fun stopStream() {
        streaming = false
        reader?.join(1_000)
        reader = null
        while (true) {
            val t = transfers.tryReceive().getOrNull() ?: break
            pool.offer(t.data)
        }
    }

    private fun out(
        request: Int,
        value: Int = 0,
        index: Int = 0,
        data: ByteArray? = null,
    ) {
        val c = conn ?: throw HackRfException(Fault.DETACHED, "not open")
        val n = c.controlTransfer(0x40, request, value, index, data, data?.size ?: 0, 1000)
        check(n == (data?.size ?: 0)) { "vendor request $request failed ($n)" }
    }

    private fun input(
        request: Int,
        length: Int,
        value: Int = 0,
        index: Int = 0,
    ): ByteArray {
        val c = conn ?: throw HackRfException(Fault.DETACHED, "not open")
        val b = ByteArray(length)
        val n = c.controlTransfer(0xC0, request, value, index, b, length, 1000)
        check(n >= 0) { "vendor request $request failed ($n)" }
        return b.copyOf(n)
    }

    private fun le32(vararg v: Int): ByteArray =
        ByteBuffer
            .allocate(4 * v.size)
            .order(ByteOrder.LITTLE_ENDIAN)
            .apply {
                v.forEach { putInt(it) }
            }.array()

    companion object {
        const val VID = 0x1d50
        const val PID = 0x6089
        private const val QUEUED = 8
        private const val POOL = 6
        private const val REQUEST_BYTES = 256 * 1024
        private const val REQUEST_TIMEOUT_MS = 250L
        private const val READ_TIMEOUT_MS = 400L
        private const val MODE_OFF = 0
        private const val MODE_RX = 1
        private const val MODE_RX_SWEEP = 5
        private const val INTERLEAVED: Byte = 1
        private const val TUNE_OFFSET = 7_500_000L
        private const val BYTES_PER_TUNE = 16_384
        private const val MAX_RANGES = 10

        // MAX2837 baseband filter steps (libhackrf max2837_ft).
        private val FILTERS =
            intArrayOf(
                1_750_000,
                2_500_000,
                3_500_000,
                5_000_000,
                5_500_000,
                6_000_000,
                7_000_000,
                8_000_000,
                9_000_000,
                10_000_000,
                12_000_000,
                14_000_000,
                15_000_000,
                20_000_000,
                24_000_000,
                28_000_000,
            )

        /** Joins the closest neighbours until at most [max] ranges remain (libhackrf's limit). */
        fun mergeRanges(
            ranges: List<Pair<Int, Int>>,
            max: Int,
        ): List<Pair<Int, Int>> {
            val r = ranges.sortedBy { it.first }.toMutableList()
            while (r.size > max) {
                val i = (0 until r.size - 1).minBy { r[it + 1].first - r[it].second }
                r[i] = r[i].first to r[i + 1].second
                r.removeAt(i + 1)
            }
            return r
        }
    }
}
