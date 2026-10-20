package dev.locarc.core

import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * A HackRF on a fake USB bus: it streams the scene through synthetic sweep blocks, 16 to a
 * transfer, at the real pace (2.7 ms a tune), and can be told to fail.
 */
class FakeHackRf(
    private val now: () -> Long,
    var tones: List<Tone> = emptyList(),
) : HackRfDriver {
    var info = DeviceInfo(2, "2023.01.1", "0000000000000000457863dc2b4a7a5f", 0x0107)
    var openFault: Fault? = null
    var detached = false

    /** Reads that fail with these faults, in order, before streaming resumes. */
    val failures = ArrayDeque<Fault>()
    var plan: SweepPlan? = null

    /** Virtual time per 16-block transfer: slower than a real HackRF, to keep tests quick. */
    var transferMs = 400L
    var receiving: Long? = null
    var opens = 0
    var resets = 0
    var tuning: Tuning? = null
    private val synth = Synth(seed = 11)
    private var tuneIndex = 0

    override suspend fun open(): DeviceInfo {
        openFault?.let { throw HackRfException(it, "open failed") }
        if (detached) throw HackRfException(Fault.DETACHED, "not attached")
        opens++
        return info
    }

    override suspend fun configure(
        t: Tuning,
        sampleRate: Int,
    ) {
        tuning = t
    }

    override suspend fun startSweep(plan: SweepPlan) {
        this.plan = plan
        receiving = null
        tuneIndex = 0
    }

    override suspend fun startReceive(centerHz: Long) {
        receiving = centerHz
        plan = null
    }

    override suspend fun read(): Transfer? {
        if (detached) throw HackRfException(Fault.DETACHED, "requestWait returned null")
        failures.removeFirstOrNull()?.let {
            delay(50)
            if (it == Fault.TRANSFER_TIMEOUT) {
                delay(10_000)
                return null
            }
            throw HackRfException(it, "fault")
        }
        val rx = receiving
        if (rx != null) {
            delay(26)
            // A carrier 1 MHz above the tune, for the calibration meter.
            val n = 131_072
            val out = ByteArray(2 * n)
            for (i in 0 until n) {
                val ph = 2 * Math.PI * 1_000_250.0 * i / 10_000_000
                out[2 * i] = (20 * Math.cos(ph)).toInt().toByte()
                out[2 * i + 1] = (20 * Math.sin(ph)).toInt().toByte()
            }
            return Transfer(out, out.size)
        }
        val p = plan ?: return null.also { delay(100) }
        val tunes = synth.tunes(p)
        val data = ByteArray(16 * SweepProcessor.BLOCK_BYTES)
        delay(transferMs)
        val at = now()
        for (b in 0 until 16) {
            synth.block(tunes[tuneIndex % tunes.size], tones, at, data, b * SweepProcessor.BLOCK_BYTES)
            tuneIndex++
        }
        return Transfer(data, data.size)
    }

    override suspend fun stop() {
        plan = null
        receiving = null
    }

    override suspend fun close() {
        plan = null
    }

    override suspend fun reset() {
        resets++
    }
}

/** The backend as the phone sees it over HTTP: token mint and sync, recording every request. */
class FakeBackend(
    private val serverNow: () -> Long,
) : HttpTransport {
    val syncs = mutableListOf<JsonObject>()
    var revoked = false
    var failSyncs = 0
    private val json = Json

    override suspend fun post(
        url: String,
        body: String,
        bearer: String?,
    ): HttpResponse {
        val req = json.parseToJsonElement(body).jsonObject
        val path = req.s("path")
        val args = req.getValue("args").jsonObject

        fun ok(value: JsonObject) =
            HttpResponse(
                200,
                buildJsonObject {
                    put("status", "success")
                    put("value", value)
                }.toString(),
            )
        return when (path) {
            "receiverAuth:token" ->
                if (revoked) {
                    HttpResponse(
                        400,
                        buildJsonObject {
                            put("status", "error")
                            put("errorMessage", "removed")
                            put("errorData", buildJsonObject { put("code", "REVOKED") })
                        }.toString(),
                    )
                } else {
                    ok(
                        buildJsonObject {
                            put("token", "jwt")
                            put("expiresAt", (serverNow() + 3_600_000).toDouble())
                        },
                    )
                }
            "sync:sync" -> {
                if (failSyncs > 0) {
                    failSyncs--
                    return HttpResponse(503, "unavailable")
                }
                syncs += args
                ok(
                    buildJsonObject {
                        put("serverTime", serverNow().toDouble())
                        put(
                            "readings",
                            buildJsonArray {
                                for (r in args["readings"]?.jsonArray.orEmpty()) {
                                    add(
                                        buildJsonObject {
                                            put("runId", r.jsonObject.s("runId"))
                                            put("k", r.jsonObject.d("k"))
                                            put("outcome", "stored")
                                        },
                                    )
                                }
                            },
                        )
                        put("board", kotlinx.serialization.json.JsonNull)
                        put("fleet", kotlinx.serialization.json.JsonNull)
                    },
                )
            }
            else -> HttpResponse(404, "{}")
        }
    }

    override suspend fun download(url: String) = ByteArray(0)

    /** Every Reading the phone has synced, decoded. */
    fun readings(): List<ReadingUpload> =
        syncs.flatMap { s ->
            s["readings"]?.jsonArray.orEmpty().map { readingUploadFromJson(it.jsonObject) }
        }
}
