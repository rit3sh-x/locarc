package dev.locarc.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File
import kotlin.math.abs

/** Wall-clock time, injectable so tests drive it. */
fun interface Clock {
    fun now(): Long
}

/**
 * The phone's clock is never trusted alone (the spike phone's was 20 days off). Each sync gives
 * a sample: offset = server time − the midpoint of send and receive, ± half the round trip; the
 * uncertainty then grows by a 50 ppm drift bound. The lowest-uncertainty sample wins.
 */
class ClockSync(
    private val local: Clock,
) : Clock {
    var offsetMs = 0.0
        private set
    private var sampleUncertainty = UNKNOWN_MS
    private var sampleAt = 0L

    fun sample(
        sentAt: Long,
        receivedAt: Long,
        serverTime: Long,
    ) {
        val rtt = (receivedAt - sentAt).coerceAtLeast(0)
        val uncertainty = rtt / 2.0 + 1
        if (uncertainty <= uncertaintyMs()) {
            offsetMs = serverTime - (sentAt + receivedAt) / 2.0
            sampleUncertainty = uncertainty
            sampleAt = receivedAt
        }
    }

    fun uncertaintyMs(): Double =
        if (sampleUncertainty >= UNKNOWN_MS) UNKNOWN_MS else sampleUncertainty + abs(local.now() - sampleAt) * DRIFT

    /** Corrected time: what every Scan boundary is computed on. */
    override fun now(): Long = local.now() + Math.round(offsetMs)

    fun restore(
        offset: Double,
        uncertainty: Double,
        at: Long,
    ) {
        offsetMs = offset
        sampleUncertainty = uncertainty
        sampleAt = at
    }

    fun snapshot() = Triple(offsetMs, sampleUncertainty, sampleAt)

    companion object {
        const val DRIFT = 50e-6
        const val UNKNOWN_MS = 3_600_000.0
    }
}

/**
 * Everything the phone must not lose, as plain files: one per item, written to a temporary name
 * and renamed. Send order: the newest Reading, calibration results, error reports, then the
 * backlog oldest first, at most 256 KB of Readings per sync. Items older than 24 h are dropped
 * and counted.
 */
class Outbox(
    private val dir: File,
    private val clock: Clock,
) {
    private val json = Json { ignoreUnknownKeys = true }

    init {
        dir.mkdirs()
    }

    private fun write(
        name: String,
        body: String,
    ) {
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(body)
        check(tmp.renameTo(File(dir, name))) { "outbox rename failed: $name" }
    }

    private fun files(prefix: String) =
        dir.listFiles { f -> f.name.startsWith(prefix) && f.name.endsWith(".json") }.orEmpty().sortedBy {
            it.name
        }

    private fun stamp() = clock.now().toString().padStart(15, '0')

    fun putReading(r: ReadingUpload) = write("r-${stamp()}-${r.runId}-${r.k}.json", r.toJson().toString())

    fun putCalibration(c: CalibrationResult) = write("c-${stamp()}-${c.session}.json", c.toJson().toString())

    fun putError(e: ErrorReport) {
        if (files("e-").size >= MAX_ERRORS) return
        write("e-${stamp()}-${(0..9999).random()}.json", e.toJson().toString())
    }

    private fun stampOf(f: File) = f.name.substring(2, 17).toLongOrNull() ?: 0L

    /** Drops Readings older than 24 h; returns how many. */
    fun expire(): Int {
        val old = files("r-").filter { clock.now() - stampOf(it) > MAX_AGE_MS }
        old.forEach { it.delete() }
        return old.size
    }

    data class Batch(
        val readings: List<Pair<File, ReadingUpload>>,
        val calibration: List<Pair<File, CalibrationResult>>,
        val errors: List<Pair<File, ErrorReport>>,
    )

    fun next(): Batch {
        val readings = files("r-")
        val ordered = listOfNotNull(readings.lastOrNull()) + readings.dropLast(1)
        var bytes = 0
        val batch = mutableListOf<Pair<File, ReadingUpload>>()
        for (f in ordered) {
            val r = runCatching { readingUploadFromJson(json.parseToJsonElement(f.readText()).jsonObject) }.getOrNull()
            if (r == null) {
                f.delete()
                continue
            }
            if (batch.isNotEmpty() && bytes + r.payload.size > MAX_BATCH_BYTES) break
            bytes += r.payload.size
            batch += f to r
        }
        val calibration =
            files("c-").mapNotNull { f ->
                val o = json.parseToJsonElement(f.readText()).jsonObject
                f to CalibrationResult(o.s("session")!!, o.d("powerDbm")!!, o.d("freqOffsetHz")!!)
            }
        val errors =
            files("e-").take(10).mapNotNull { f ->
                val o = json.parseToJsonElement(f.readText()).jsonObject
                f to ErrorReport(o.s("kind")!!, o.s("message")!!, o.s("stack"), o.s("context")!!)
            }
        return Batch(batch, calibration, errors)
    }

    fun depth(): Int = files("r-").size + files("c-").size + files("e-").size

    fun oldestAgeS(): Double {
        val oldest = (files("r-") + files("c-") + files("e-")).minOfOrNull { stampOf(it) } ?: return 0.0
        return (clock.now() - oldest) / 1000.0
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    companion object {
        const val MAX_BATCH_BYTES = 256 * 1024
        const val MAX_AGE_MS = 24 * 3_600_000L
        const val MAX_ERRORS = 50
    }
}

/** Small persistent state (JSON): what survives a restart besides the outbox and the secret. */
class StateFile(
    private val file: File,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private var cache: JsonObject = runCatching { json.parseToJsonElement(file.readText()).jsonObject }.getOrElse { JsonObject(emptyMap()) }

    fun getLong(key: String): Long? = cache.l(key)

    fun getDouble(key: String): Double? = cache.d(key)

    fun getString(key: String): String? = cache.s(key)

    fun put(values: Map<String, Any?>) {
        cache =
            buildJsonObject {
                cache.forEach { (k, v) -> put(k, v) }
                values.forEach { (k, v) ->
                    when (v) {
                        null -> put(k, ConvexJson.str(null))
                        is Number -> put(k, ConvexJson.num(v))
                        is String -> put(k, v)
                        is Boolean -> put(k, v)
                        else -> error("unsupported state value for $k")
                    }
                }
            }
        val tmp = File(file.path + ".tmp")
        tmp.writeText(cache.toString())
        tmp.renameTo(file)
    }

    fun clear() {
        cache = JsonObject(emptyMap())
        file.delete()
    }
}
