package dev.locarc.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.Base64

// The sync contract with convex/sync.ts, in Convex's JSON format: numbers are floats,
// bytes are {"$bytes": base64}. Pinned by wire/sync-request.json and wire/sync-reply.json.

data class PositionFix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val at: Long,
)

data class HackRfStatus(
    val state: String,
    val serial: String?,
    val boardId: Int?,
    val firmware: String?,
    val ladder: Int,
    val faults: Map<String, Int>,
    val detachedSince: Long?,
)

data class WindowMode(
    val mode: String,
    val reason: String?,
)

data class Heartbeat(
    val appVersion: String,
    val appVersionCode: Int,
    val battery: Double,
    val charging: Boolean,
    val thermal: String,
    val selfPause: String?,
    val hackrf: HackRfStatus,
    val clippedHz: List<Double>,
    val window: WindowMode,
    val setupGaps: List<String>,
    val outboxDepth: Int,
    val outboxOldestAgeS: Double,
    val outboxDropped: Int,
    val clockOffsetMs: Double,
    val clockUncertaintyMs: Double,
    val gpsAccuracyM: Double?,
    val appliedConfigV: Int?,
    val rejectedConfig: Pair<Int, String>?,
    val lastError: String?,
)

data class ReadingUpload(
    val runId: String,
    val k: Long,
    val appVersion: String,
    val lnaDb: Int,
    val vgaDb: Int,
    val amp: Boolean,
    val ppm: Double,
    val windowMs: Long,
    val passes: Int,
    val fixPasses: Int,
    val stopReason: String?,
    val start: PositionFix?,
    val end: PositionFix?,
    val clockUncertaintyMs: Double,
    val payload: ByteArray,
)

data class ErrorReport(
    val kind: String,
    val message: String,
    val stack: String?,
    val context: String,
)

data class CalibrationResult(
    val session: String,
    val powerDbm: Double,
    val freqOffsetHz: Double,
)

data class SyncRequest(
    val sentAt: Long,
    val heartbeat: Heartbeat,
    val position: PositionFix? = null,
    val readings: List<ReadingUpload> = emptyList(),
    val ackSeq: Int? = null,
    val boardSince: Long? = null,
    val fleetSince: Long? = null,
    val errors: List<ErrorReport> = emptyList(),
    val calibration: List<CalibrationResult> = emptyList(),
)

data class ReadingOutcome(
    val runId: String,
    val k: Long,
    val outcome: String,
)

data class BoardEnvelope(
    val at: Long,
    val rasterHz: Long,
    val receivers: List<Pair<String, String>>,
    val items: ByteArray,
)

data class FleetMember(
    val receiver: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val pinned: Boolean,
)

data class SyncReply(
    val serverTime: Long,
    val readings: List<ReadingOutcome>,
    val board: BoardEnvelope?,
    val fleet: Pair<Long, List<FleetMember>>?,
)

object ConvexJson {
    fun bytes(b: ByteArray): JsonObject = buildJsonObject { put("\$bytes", Base64.getEncoder().encodeToString(b)) }

    fun bytesOf(e: JsonElement): ByteArray =
        Base64.getDecoder().decode(
            e.jsonObject
                .getValue("\$bytes")
                .jsonPrimitive.content,
        )

    fun num(x: Number?): JsonElement = if (x == null) JsonNull else JsonPrimitive(x.toDouble())

    fun str(x: String?): JsonElement = if (x == null) JsonNull else JsonPrimitive(x)
}

private fun JsonObjectBuilder.num(
    key: String,
    x: Number?,
) = put(key, ConvexJson.num(x))

private fun JsonObjectBuilder.str(
    key: String,
    x: String?,
) = put(key, ConvexJson.str(x))

private fun PositionFix.toJson() =
    buildJsonObject {
        num("lat", lat)
        num("lng", lng)
        num("accuracyM", accuracyM)
        num("at", at)
    }

fun Heartbeat.toJson(): JsonObject =
    buildJsonObject {
        str("appVersion", appVersion)
        num("appVersionCode", appVersionCode)
        num("battery", battery)
        put("charging", charging)
        str("thermal", thermal)
        str("selfPause", selfPause)
        put(
            "hackrf",
            buildJsonObject {
                str("state", hackrf.state)
                str("serial", hackrf.serial)
                num("boardId", hackrf.boardId)
                str("firmware", hackrf.firmware)
                num("ladder", hackrf.ladder)
                put("faults", buildJsonObject { hackrf.faults.forEach { (k, v) -> num(k, v) } })
                num("detachedSince", hackrf.detachedSince)
            },
        )
        put("clippedHz", buildJsonArray { clippedHz.forEach { add(JsonPrimitive(it)) } })
        put(
            "window",
            buildJsonObject {
                str("mode", window.mode)
                str("reason", window.reason)
            },
        )
        put("setupGaps", buildJsonArray { setupGaps.forEach { add(JsonPrimitive(it)) } })
        put(
            "outbox",
            buildJsonObject {
                num("depth", outboxDepth)
                num("oldestAgeS", outboxOldestAgeS)
                num("dropped", outboxDropped)
            },
        )
        put(
            "clock",
            buildJsonObject {
                num("offsetMs", clockOffsetMs)
                num("uncertaintyMs", clockUncertaintyMs)
            },
        )
        num("gpsAccuracyM", gpsAccuracyM)
        num("appliedConfigV", appliedConfigV)
        put(
            "rejectedConfig",
            rejectedConfig?.let { (v, reason) ->
                buildJsonObject {
                    num("v", v)
                    str("reason", reason)
                }
            } ?: JsonNull,
        )
        str("lastError", lastError)
    }

fun ReadingUpload.toJson(): JsonObject =
    buildJsonObject {
        str("runId", runId)
        num("k", k)
        str("appVersion", appVersion)
        num("lnaDb", lnaDb)
        num("vgaDb", vgaDb)
        put("amp", amp)
        num("ppm", ppm)
        num("windowMs", windowMs)
        num("passes", passes)
        num("fixPasses", fixPasses)
        str("stopReason", stopReason)
        put("start", start?.toJson() ?: JsonNull)
        put("end", end?.toJson() ?: JsonNull)
        num("clockUncertaintyMs", clockUncertaintyMs)
        put("payload", ConvexJson.bytes(payload))
    }

fun readingUploadFromJson(o: JsonObject) =
    ReadingUpload(
        runId = o.s("runId")!!,
        k = o.l("k")!!,
        appVersion = o.s("appVersion")!!,
        lnaDb = o.i("lnaDb")!!,
        vgaDb = o.i("vgaDb")!!,
        amp = o.b("amp")!!,
        ppm = o.d("ppm")!!,
        windowMs = o.l("windowMs")!!,
        passes = o.i("passes")!!,
        fixPasses = o.i("fixPasses")!!,
        stopReason = o.s("stopReason"),
        start = o.obj("start")?.let(::positionFromJson),
        end = o.obj("end")?.let(::positionFromJson),
        clockUncertaintyMs = o.d("clockUncertaintyMs")!!,
        payload = ConvexJson.bytesOf(o.getValue("payload")),
    )

private fun positionFromJson(o: JsonObject) = PositionFix(o.d("lat")!!, o.d("lng")!!, o.d("accuracyM")!!, o.l("at")!!)

fun ErrorReport.toJson(): JsonObject =
    buildJsonObject {
        str("kind", kind)
        str("message", message)
        str("stack", stack)
        str("context", context)
    }

fun CalibrationResult.toJson(): JsonObject =
    buildJsonObject {
        str("session", session)
        num("powerDbm", powerDbm)
        num("freqOffsetHz", freqOffsetHz)
    }

/** The `args` of sync:sync. Optional keys are left out when empty, as the sample request does. */
fun SyncRequest.toArgs(): JsonObject =
    buildJsonObject {
        num("sentAt", sentAt)
        put("heartbeat", heartbeat.toJson())
        position?.let { put("position", it.toJson()) }
        if (readings.isNotEmpty()) put("readings", JsonArray(readings.map { it.toJson() }))
        ackSeq?.let { num("ackSeq", it) }
        boardSince?.let { num("boardSince", it) }
        fleetSince?.let { num("fleetSince", it) }
        if (errors.isNotEmpty()) put("errors", JsonArray(errors.map { it.toJson() }))
        if (calibration.isNotEmpty()) put("calibration", JsonArray(calibration.map { it.toJson() }))
    }

fun syncReplyFromJson(value: JsonElement): SyncReply {
    val o = value.jsonObject
    return SyncReply(
        serverTime = o.l("serverTime")!!,
        readings =
            o.getValue("readings").jsonArray.map {
                val r = it.jsonObject
                ReadingOutcome(r.s("runId")!!, r.l("k")!!, r.s("outcome")!!)
            },
        board =
            o.obj("board")?.let { b ->
                BoardEnvelope(
                    at = b.l("at")!!,
                    rasterHz = b.l("rasterHz")!!,
                    receivers = b.getValue("receivers").jsonArray.map { r -> r.jsonObject.s("id")!! to r.jsonObject.s("name")!! },
                    items = ConvexJson.bytesOf(b.getValue("items")),
                )
            },
        fleet =
            o.obj("fleet")?.let { f ->
                f.l("at")!! to
                    f.getValue("items").jsonArray.map { m ->
                        val x = m.jsonObject
                        FleetMember(x.s("receiver")!!, x.s("name")!!, x.d("lat")!!, x.d("lng")!!, x.d("accuracyM")!!, x.b("pinned")!!)
                    }
            },
    )
}

// The control document (control:mine)

data class ReceiverConfig(
    val name: String,
    val lnaDb: Int,
    val vgaDb: Int,
    val amp: Boolean,
    val offsetDb: Double,
    val ppm: Double,
    val pinned: Pair<Double, Double>?,
) {
    /** The ranges the backend validates too; an out-of-range push is rejected with this reason. */
    fun problem(): String? =
        when {
            lnaDb !in 0..40 || lnaDb % 8 != 0 -> "LNA $lnaDb dB is not 0–40 in steps of 8"
            vgaDb !in 0..62 || vgaDb % 2 != 0 -> "VGA $vgaDb dB is not 0–62 in steps of 2"
            offsetDb !in -30.0..30.0 -> "offset $offsetDb dB is outside ±30"
            ppm !in -50.0..50.0 -> "frequency correction $ppm ppm is outside ±50"
            else -> null
        }
}

data class Command(
    val seq: Int,
    val kind: String,
    val session: String,
    val referenceHz: Double,
    val durationS: Double,
    val mode: String,
)

data class Release(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val size: Long,
    val minSupported: Int?,
)

data class ControlDoc(
    val run: RunInfo?,
    val paused: Boolean,
    val configV: Int,
    val config: ReceiverConfig,
    val commands: List<Command>,
    val release: Release?,
)

fun controlFromJson(value: JsonElement): ControlDoc? {
    if (value is JsonNull) return null
    val o = value.jsonObject
    val cfg = o.getValue("config").jsonObject
    val values = cfg.getValue("values").jsonObject
    val position = values.getValue("position").jsonObject
    return ControlDoc(
        run =
            o.obj("run")?.let { r ->
                val plan = r.getValue("plan").jsonObject
                RunInfo(
                    runId = r.s("runId")!!,
                    number = r.i("number")!!,
                    startsAt = r.l("startsAt")!!,
                    periodMs = r.l("periodMs")!!,
                    plan =
                        SweepPlan(
                            plan.getValue("segments").jsonArray.map { s ->
                                Segment(s.jsonObject.l("startHz")!!, s.jsonObject.l("endHz")!!)
                            },
                            plan.l("rasterHz")!!,
                        ),
                    fixWindowMs = r.l("fixWindowMs")!!,
                    uploadMarginMs = r.l("uploadMarginMs")!!,
                    burstEndsAt = r.l("burstEndsAt"),
                )
            },
        paused = o.b("paused") ?: false,
        configV = cfg.i("v")!!,
        config =
            ReceiverConfig(
                name = values.s("name")!!,
                lnaDb = values.i("lnaDb")!!,
                vgaDb = values.i("vgaDb")!!,
                amp = values.b("amp") ?: false,
                offsetDb = values.d("offsetDb")!!,
                ppm = values.d("ppm")!!,
                pinned = if (position.s("mode") == "pinned") position.d("lat")!! to position.d("lng")!! else null,
            ),
        commands =
            o.getValue("commands").jsonArray.map {
                val c = it.jsonObject
                Command(c.i("seq")!!, c.s("kind")!!, c.s("session")!!, c.d("referenceHz")!!, c.d("durationS")!!, c.s("mode")!!)
            },
        release =
            o.obj("release")?.let { r ->
                Release(r.i("versionCode")!!, r.s("versionName")!!, r.s("sha256")!!, r.l("size")!!, r.i("minSupported"))
            },
    )
}

// Small readers over Convex JSON (numbers arrive as floats).
internal fun JsonObject.obj(key: String): JsonObject? = (this[key] as? JsonObject)

internal fun JsonObject.s(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

internal fun JsonObject.d(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

internal fun JsonObject.l(key: String): Long? = d(key)?.let { Math.round(it) }

internal fun JsonObject.i(key: String): Int? = d(key)?.let { Math.round(it).toInt() }

internal fun JsonObject.b(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
