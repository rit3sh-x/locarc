package dev.locarc.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

// Every write goes over Convex's HTTP API: the token mint, pairing, sync and the release download URL.

class HttpResponse(
    val status: Int,
    val body: String,
)

interface HttpTransport {
    suspend fun post(
        url: String,
        body: String,
        bearer: String?,
    ): HttpResponse

    suspend fun download(url: String): ByteArray
}

/** `HttpURLConnection`, the platform's own client: no extra dependency. */
class UrlConnectionTransport(
    private val timeoutMs: Int = 20_000,
) : HttpTransport {
    override suspend fun post(
        url: String,
        body: String,
        bearer: String?,
    ): HttpResponse =
        withContext(Dispatchers.IO) {
            val c = URI(url).toURL().openConnection() as HttpURLConnection
            try {
                c.requestMethod = "POST"
                c.connectTimeout = timeoutMs
                c.readTimeout = timeoutMs
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                if (bearer != null) c.setRequestProperty("Authorization", "Bearer $bearer")
                c.outputStream.use { it.write(body.toByteArray()) }
                val status = c.responseCode
                val stream = if (status < 400) c.inputStream else c.errorStream
                HttpResponse(status, stream?.use { it.readBytes().decodeToString() } ?: "")
            } finally {
                c.disconnect()
            }
        }

    override suspend fun download(url: String): ByteArray =
        withContext(Dispatchers.IO) {
            val c = URI(url).toURL().openConnection() as HttpURLConnection
            try {
                c.connectTimeout = timeoutMs
                c.readTimeout = 120_000
                if (c.responseCode != 200) throw IOException("download failed: HTTP ${c.responseCode}")
                c.inputStream.use { it.readBytes() }
            } finally {
                c.disconnect()
            }
        }
}

/** A Convex function failed: `code` is the backend's ConvexError code (REVOKED, CODE_INVALID, …). */
class ConvexCallException(
    val code: String?,
    message: String,
) : Exception(message)

class ConvexHttp(
    val deploymentUrl: String,
    private val transport: HttpTransport,
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun call(
        kind: String,
        path: String,
        args: JsonObject,
        token: String? = null,
    ): JsonElement {
        val body =
            buildJsonObject {
                put("path", path)
                put("args", args)
                put("format", "json")
            }.toString()
        val r = transport.post("${deploymentUrl.trimEnd('/')}/api/$kind", body, token)
        val parsed =
            runCatching { json.parseToJsonElement(r.body).jsonObject }.getOrElse {
                throw IOException("HTTP ${r.status} from $path: ${r.body.take(200)}")
            }
        if (parsed.s("status") == "success") return parsed.getValue("value")
        val data = parsed.obj("errorData")
        if (r.status >= 500 && data == null) throw IOException("HTTP ${r.status} from $path")
        throw ConvexCallException(
            data?.s("code") ?: if (r.status ==
                401
            ) {
                "UNAUTHENTICATED"
            } else {
                null
            },
            parsed.s("errorMessage") ?: "HTTP ${r.status}",
        )
    }
}

data class Paired(
    val receiverId: String,
    val name: String,
    val secret: String,
)

/** Pairing and the 1-hour Receiver JWT, minted again when less than 10 minutes remain. */
class ReceiverAuth(
    private val api: ConvexHttp,
    private val clock: Clock,
    private val secret: () -> String?,
) {
    private var token: Pair<String, Long>? = null

    suspend fun pair(code: String): Paired {
        val r = api.call("action", "receiverAuth:pair", buildJsonObject { put("code", code) }).jsonObject
        token = r.s("token")!! to r.l("expiresAt")!!
        return Paired(r.s("receiverId")!!, r.s("name")!!, r.s("secret")!!)
    }

    /** A valid token; throws ConvexCallException(REVOKED) once the Receiver is removed. */
    suspend fun token(force: Boolean = false): String {
        val t = token
        if (!force && t != null && t.second - clock.now() > REFRESH_BEFORE_MS) return t.first
        val s = secret() ?: throw ConvexCallException("REVOKED", "not paired")
        val r = api.call("action", "receiverAuth:token", buildJsonObject { put("secret", s) }).jsonObject
        val fresh = r.s("token")!! to r.l("expiresAt")!!
        token = fresh
        return fresh.first
    }

    /** When the cached token expires (0 when there is none). */
    fun expiresAt(): Long = token?.second ?: 0

    fun forget() {
        token = null
    }

    companion object {
        const val REFRESH_BEFORE_MS = 10 * 60_000L
    }
}

class SyncClient(
    private val api: ConvexHttp,
    private val auth: ReceiverAuth,
) {
    suspend fun sync(req: SyncRequest): SyncReply =
        withToken { token -> syncReplyFromJson(api.call("mutation", "sync:sync", req.toArgs(), token)) }

    /** A fresh storage URL for the promoted release, or null when there is none. */
    suspend fun downloadUrl(): Pair<String, String>? =
        withToken { token ->
            val v = api.call("query", "releases:downloadUrl", JsonObject(emptyMap()), token)
            (v as? JsonObject)?.let { it.s("url")!! to it.s("sha256")!! }
        }

    /** One retry with a forced re-mint when the backend says the token is no good. */
    private suspend fun <T> withToken(block: suspend (String) -> T): T =
        try {
            block(auth.token())
        } catch (e: ConvexCallException) {
            if (e.code != "UNAUTHENTICATED") throw e
            block(auth.token(force = true))
        }
}
