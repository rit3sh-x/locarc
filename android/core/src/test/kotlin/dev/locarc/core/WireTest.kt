package dev.locarc.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

/** The golden files in convex/lib/wire/: the TypeScript tests read the very same bytes. */
class WireTest {
    private fun resource(name: String): JsonObject = Json.parseToJsonElement(javaClass.getResource("/$name")!!.readText()).jsonObject

    private fun JsonObject.num(k: String) = getValue(k).jsonPrimitive.doubleOrNull

    private fun JsonObject.bool(k: String) = getValue(k).jsonPrimitive.booleanOrNull!!

    @Test
    fun `the Reading encoder reproduces the golden bytes, and decodes them back`() {
        val g = resource("reading.golden.json")
        val p = g.getValue("payload").jsonObject
        val payload =
            ReadingPayload(
                slices =
                    p.getValue("slices").jsonArray.map {
                        val s = it.jsonObject
                        Slice(s.num("floorDbm")!!, s.bool("clippedFix"), s.bool("clippedLater"), s.bool("anomaly"))
                    },
                emitters =
                    p.getValue("emitters").jsonArray.map {
                        val e = it.jsonObject
                        EmitterRecord(
                            firstCh = e.num("firstCh")!!.toLong(),
                            widthCh = e.num("widthCh")!!.toInt(),
                            strongestCh = e.num("strongestCh")!!.toLong(),
                            fixPowerDbm = e.num("fixPowerDbm"),
                            peakDbm = e.num("peakDbm")!!,
                            passesOn = e.num("passesOn")!!.toInt(),
                            clippedFix = e.bool("clippedFix"),
                            clippedLater = e.bool("clippedLater"),
                        )
                    },
            )
        val hex = g.getValue("hex").jsonPrimitive.content
        assertEquals(hex, ReadingCodec.encode(payload).toHex())
        assertEquals(payload, ReadingCodec.decode(hex.fromHex()))
    }

    @Test
    fun `the Reading encoder refuses more than 4,000 Emitters and unknown versions`() {
        val many = List(4001) { EmitterRecord(it.toLong(), 1, it.toLong(), -90.0, -88.0, 1, false, false) }
        assertFailsWith<IllegalArgumentException> { ReadingCodec.encode(ReadingPayload(emptyList(), many)) }
        assertFailsWith<IllegalArgumentException> { ReadingCodec.decode(byteArrayOf(2, 0, 0, 0, 0)) }
    }

    @Test
    fun `the board decoder turns the golden bytes into the golden items`() {
        val g = resource("board.golden.json")
        val items =
            BoardCodec.decode(
                g
                    .getValue("hex")
                    .jsonPrimitive.content
                    .fromHex(),
            )
        val expected = g.getValue("items").jsonArray.map { it.jsonObject }
        assertEquals(expected.size, items.size)
        for ((want, got) in expected.zip(items)) {
            assertEquals(want.num("ch")!!.toLong(), got.ch)
            assertEquals(want.num("widthCh")!!.toInt(), got.widthCh)
            assertEquals(want.num("heard")!!.toInt(), got.heard)
            assertEquals(want.bool("located"), got.located)
            assertEquals(want.bool("collinear"), got.collinear)
            assertEquals((want["missed"] as? JsonPrimitive)?.doubleOrNull?.toInt(), got.missed)
            assertEquals(want.num("occupancy"), got.occupancy)
            assertEquals((want["powerDbm"] as? JsonPrimitive)?.doubleOrNull, got.powerDbm)
            val pos = want["position"] as? JsonObject
            assertEquals(pos?.num("lat"), got.position?.lat)
            assertEquals(pos?.num("lng"), got.position?.lng)
            val stored = want["lastStored"] as? JsonObject
            assertEquals(stored?.num("at")?.toLong(), got.lastStored?.at)
            assertEquals(stored?.num("occupancyClass")?.toInt(), got.lastStored?.occupancyClass)
        }
    }

    @Test
    fun `the sync request serialises to the committed sample`() {
        val body = resource("sync-request.json").getValue("body").jsonObject
        val args = body.getValue("args").jsonObject
        val reading = readingUploadFromJson(args.getValue("readings").jsonArray[0].jsonObject)
        val hb = args.getValue("heartbeat").jsonObject
        val hackrf = hb.getValue("hackrf").jsonObject
        val req =
            SyncRequest(
                sentAt = 1792411317000,
                heartbeat =
                    Heartbeat(
                        appVersion = "1.0.0",
                        appVersionCode = 100,
                        battery = 0.82,
                        charging = true,
                        thermal = "light",
                        selfPause = null,
                        hackrf =
                            HackRfStatus(
                                "streaming",
                                hackrf.getValue("serial").jsonPrimitive.content,
                                2,
                                "2023.01.1",
                                1,
                                mapOf("TRANSFER_TIMEOUT" to 1),
                                null,
                            ),
                        clippedHz = listOf(406125000.0),
                        window = WindowMode("short", "warm"),
                        setupGaps = listOf("autostart", "notifications"),
                        outboxDepth = 2,
                        outboxOldestAgeS = 41.0,
                        outboxDropped = 0,
                        clockOffsetMs = -1728000000.0,
                        clockUncertaintyMs = 38.0,
                        gpsAccuracyM = 7.5,
                        appliedConfigV = 3,
                        rejectedConfig = null,
                        lastError = null,
                    ),
                position = PositionFix(12.9774, 77.5878, 7.5, 1792411310000),
                readings = listOf(reading),
                ackSeq = 2,
                boardSince = 0,
                fleetSince = 0,
                errors =
                    listOf(
                        ErrorReport(
                            "IllegalStateException",
                            "outbox file vanished",
                            "java.lang.IllegalStateException: outbox file vanished\n\tat dev.locarc.core.Outbox.next(Outbox.kt:88)",
                            "engine",
                        ),
                    ),
            )
        assertEquals("\$RUN_ID", reading.runId)
        assertEquals(canonical(args), canonical(req.toArgs()))
        // The payload inside is the golden Reading.
        val golden = resource("reading.golden.json").getValue("hex").jsonPrimitive.content
        assertEquals(golden, reading.payload.toHex())
    }

    @Test
    fun `the sample sync reply parses, board and fleet included`() {
        val reply = syncReplyFromJson(resource("sync-reply.json").getValue("value"))
        assertEquals(listOf(ReadingOutcome("\$RUN_ID", 0, "stored")), reply.readings)
        val board = assertNotNull(reply.board)
        assertEquals(12_500, board.rasterHz)
        assertEquals(3, BoardCodec.decode(board.items).size)
        assertEquals(
            "Gate 2",
            reply.fleet!!
                .second
                .single()
                .name,
        )
    }

    /** Key order and 1 vs 1.0 don't matter on the wire; everything else does. */
    private fun canonical(e: JsonElement): Any? =
        when (e) {
            is JsonNull -> null
            is JsonObject -> e.entries.sortedBy { it.key }.associate { it.key to canonical(it.value) }
            is JsonArray -> e.map(::canonical)
            is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.doubleOrNull
        }
}
