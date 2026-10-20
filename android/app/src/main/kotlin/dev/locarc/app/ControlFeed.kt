package dev.locarc.app

import android.content.Context
import dev.convex.android.AuthProvider
import dev.convex.android.ConvexClientWithAuth
import dev.locarc.core.ConvexCallException
import dev.locarc.core.Engine
import dev.locarc.core.ErrorReport
import dev.locarc.core.controlFromJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/**
 * The phone's one live subscription, `control:mine`, through the Convex Android client. Writes
 * never go through this client (its mutation retry can run twice); sync uses HTTP.
 */
class ControlFeed(
    private val context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private var refresher: Job? = null

    fun start(
        url: String,
        engine: Engine,
    ) {
        stop()
        job =
            scope.launch {
                val auth = ReceiverTokens(engine)
                val client = ConvexClientWithAuth(url, auth)
                client.loginFromCache()
                // Push a fresh token before the hour is up, so the socket never drops for expiry.
                refresher =
                    launch {
                        while (isActive) {
                            delay(50 * 60_000L)
                            runCatching { auth.push(engine.auth.token(force = true)) }
                        }
                    }
                while (isActive) {
                    client.subscribe<JsonElement>("control:mine").collect { result ->
                        result
                            .onSuccess { engine.onControl(controlFromJson(it)) }
                            .onFailure { e ->
                                // The unauthenticated-socket trap: the client still thinks it's signed
                                // in after a failed refresh. Report it and force a fresh token.
                                if ("UNAUTHENTICATED" in (e.message ?: "") || "Unauthenticated" in (e.message ?: "")) {
                                    engine.reportError(
                                        ErrorReport("UnauthenticatedSocket", "control subscription lost auth", null, "control"),
                                    )
                                    runCatching { auth.push(engine.auth.token(force = true)) }
                                }
                            }
                    }
                    delay(5_000)
                }
            }
    }

    fun stop() {
        refresher?.cancel()
        job?.cancel()
        job = null
    }
}

/** Mints Receiver JWTs over HTTP (the engine's auth) and hands them to the Convex client. */
private class ReceiverTokens(
    private val engine: Engine,
) : AuthProvider<String> {
    private var onIdToken: ((String?) -> Unit)? = null

    fun push(token: String) {
        onIdToken?.invoke(token)
    }

    override suspend fun login(
        context: Context,
        onIdToken: (String?) -> Unit,
    ): Result<String> = loginFromCache(onIdToken)

    override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> {
        this.onIdToken = onIdToken
        return try {
            Result.success(engine.auth.token())
        } catch (e: ConvexCallException) {
            if (e.code == "REVOKED") onIdToken(null)
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun logout(context: Context): Result<Void?> = Result.success(null)

    override fun extractIdToken(authResult: String): String = authResult
}
