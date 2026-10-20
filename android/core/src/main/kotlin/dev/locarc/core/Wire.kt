package dev.locarc.core

import java.nio.ByteBuffer
import java.nio.ByteOrder

// The packed formats shared with the backend (convex/lib/readingCodec.ts, boardCodec.ts). Both
// are pinned by the golden files in convex/lib/wire/, which the tests read.

data class Slice(
    val floorDbm: Double,
    val clippedFix: Boolean,
    val clippedLater: Boolean,
    val anomaly: Boolean,
)

data class EmitterRecord(
    val firstCh: Long,
    val widthCh: Int,
    /** Absolute channel number of its strongest Channel. */
    val strongestCh: Long,
    /** Total power over its span, averaged over the Fix window; null when on only later. */
    val fixPowerDbm: Double?,
    /** The strongest single Channel in any single pass. */
    val peakDbm: Double,
    /** Occupancy = passesOn ÷ the Reading's passes. */
    val passesOn: Int,
    val clippedFix: Boolean,
    val clippedLater: Boolean,
)

data class ReadingPayload(
    val slices: List<Slice>,
    val emitters: List<EmitterRecord>,
)

/** Rounds like JavaScript's Math.round (half up), which the TypeScript codec uses. */
private fun jsRound(x: Double): Long = Math.round(x)

private fun tenths(x: Double): Short = jsRound(x * 10).coerceIn(-0x7fffL, 0x7fffL).toShort()

private fun u16(x: Double): Short = jsRound(x).coerceIn(0L, 0xffffL).toInt().toShort()

private fun ByteBuffer.u16(at: Int): Int = getShort(at).toInt() and 0xffff

private fun ByteBuffer.u8(at: Int): Int = get(at).toInt() and 0xff

private fun ByteBuffer.u32(at: Int): Long = getInt(at).toLong() and 0xffffffffL

/** Reading payload, version 1: 3 B per 5 MHz slice and 15 B per Emitter after a 5-byte frame. */
object ReadingCodec {
    const val VERSION = 1
    const val MAX_EMITTERS = 4000
    private const val NONE: Short = -0x8000

    fun encode(p: ReadingPayload): ByteArray {
        require(p.emitters.size <= MAX_EMITTERS) { "more than $MAX_EMITTERS Emitters" }
        require(p.slices.size <= 0xffff) { "too many slices" }
        val b = ByteBuffer.allocate(5 + 3 * p.slices.size + 15 * p.emitters.size).order(ByteOrder.LITTLE_ENDIAN)
        b.put(VERSION.toByte())
        b.putShort(p.slices.size.toShort())
        for (s in p.slices) {
            b.putShort(tenths(s.floorDbm))
            b.put(((if (s.clippedFix) 1 else 0) or (if (s.clippedLater) 2 else 0) or (if (s.anomaly) 4 else 0)).toByte())
        }
        b.putShort(p.emitters.size.toShort())
        for (e in p.emitters.sortedBy { it.firstCh }) {
            b.putInt(e.firstCh.toInt())
            b.putShort(u16(e.widthCh.toDouble()))
            b.putShort(u16((e.strongestCh - e.firstCh).toDouble()))
            b.putShort(e.fixPowerDbm?.let(::tenths) ?: NONE)
            b.putShort(tenths(e.peakDbm))
            b.putShort(u16(e.passesOn.toDouble()))
            b.put(((if (e.clippedFix) 1 else 0) or (if (e.clippedLater) 2 else 0)).toByte())
        }
        return b.array()
    }

    fun decode(bytes: ByteArray): ReadingPayload {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val version = b.u8(0)
        require(version == VERSION) { "unsupported Reading codec version $version" }
        var o = 3
        val slices =
            List(b.u16(1)) {
                val flags = b.u8(o + 2)
                Slice(b.getShort(o) / 10.0, flags and 1 != 0, flags and 2 != 0, flags and 4 != 0).also { o += 3 }
            }
        val count = b.u16(o)
        o += 2
        val emitters =
            List(count) {
                val first = b.u32(o)
                val fix = b.getShort(o + 8)
                val flags = b.u8(o + 14)
                EmitterRecord(
                    firstCh = first,
                    widthCh = b.u16(o + 4),
                    strongestCh = first + b.u16(o + 6),
                    fixPowerDbm = if (fix == NONE) null else fix / 10.0,
                    peakDbm = b.getShort(o + 10) / 10.0,
                    passesOn = b.u16(o + 12),
                    clippedFix = flags and 1 != 0,
                    clippedLater = flags and 2 != 0,
                ).also { o += 15 }
            }
        require(o == bytes.size) { "Reading payload has trailing bytes" }
        return ReadingPayload(slices, emitters)
    }
}

data class Place(
    val lat: Double,
    val lng: Double,
    val radiusM: Double,
    val ptDbm: Double,
)

data class StoredFix(
    val place: Place,
    val occupancyClass: Int,
    val at: Long,
)

data class BoardItem(
    val ch: Long,
    val firstCh: Long,
    val widthCh: Int,
    val heard: Int,
    val used: Int,
    val loudest: Int,
    val located: Boolean,
    val unconfirmed: Boolean,
    val poorFit: Boolean,
    val collinear: Boolean,
    val receiverMoved: Boolean,
    val clipped: Boolean,
    val fixStored: Boolean,
    /** Scans since it was last located: 0–2, or null when never located. */
    val missed: Int?,
    val powerDbm: Double?,
    val peakDbm: Double,
    /** Share of the window's passes it was on, 0–1. */
    val occupancy: Double,
    val position: Place?,
    val lastStored: StoredFix?,
)

/** The Emitter board, version 1: 50 B an item. The phone only decodes it (for its Map). */
object BoardCodec {
    const val VERSION = 1
    const val ITEM_BYTES = 50
    private const val NONE: Short = -0x8000
    private const val NEVER = 255

    fun decode(bytes: ByteArray): List<BoardItem> {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val version = b.u8(0)
        require(version == VERSION) { "unsupported board version $version" }
        val count = b.u16(1)
        require(bytes.size == 3 + count * ITEM_BYTES) { "board has bad length" }
        return List(count) { i ->
            val o = 3 + i * ITEM_BYTES
            val flags = b.u8(o + 13)
            val missed = b.u8(o + 14)
            val power = b.getShort(o + 15)
            val at = b.u32(o + 46)

            fun flag(bit: Int) = flags and (1 shl bit) != 0
            BoardItem(
                ch = b.u32(o),
                firstCh = b.u32(o + 4),
                widthCh = b.u16(o + 8),
                heard = b.u8(o + 10),
                used = b.u8(o + 11),
                loudest = b.u8(o + 12),
                located = flag(0),
                unconfirmed = flag(1),
                poorFit = flag(2),
                collinear = flag(3),
                receiverMoved = flag(4),
                clipped = flag(5),
                fixStored = flag(6),
                missed = if (missed == NEVER) null else missed,
                powerDbm = if (power == NONE) null else power / 10.0,
                peakDbm = b.getShort(o + 17) / 10.0,
                occupancy = b.u16(o + 19) / 10_000.0,
                position =
                    if (missed == NEVER) {
                        null
                    } else {
                        Place(b.getInt(o + 21) / 1e6, b.getInt(o + 25) / 1e6, b.u16(o + 29).toDouble(), b.getShort(o + 31) / 10.0)
                    },
                lastStored =
                    if (at == 0L) {
                        null
                    } else {
                        StoredFix(
                            Place(b.getInt(o + 33) / 1e6, b.getInt(o + 37) / 1e6, b.u16(o + 41).toDouble(), b.getShort(o + 43) / 10.0),
                            b.u8(o + 45),
                            at * 1000,
                        )
                    },
            )
        }
    }
}

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

fun String.fromHex(): ByteArray = chunked(2).map { it.toInt(16).toByte() }.toByteArray()
