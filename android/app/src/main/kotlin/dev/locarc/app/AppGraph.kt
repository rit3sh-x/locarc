package dev.locarc.app

import android.app.Application
import android.content.Context
import android.hardware.usb.UsbManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.locarc.core.Clock
import dev.locarc.core.ConvexHttp
import dev.locarc.core.Engine
import dev.locarc.core.ErrorReport
import dev.locarc.core.Paired
import dev.locarc.core.ReceiverAuth
import dev.locarc.core.StateFile
import dev.locarc.core.UrlConnectionTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class LocarcApp : Application() {
    lateinit var graph: AppGraph

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        CrashReporter.install(this)
    }
}

val Context.graph: AppGraph get() = (applicationContext as LocarcApp).graph

/** The Receiver secret, AES-GCM encrypted with an Android Keystore key, in one small file. */
class SecretStore(
    private val file: File,
) {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec
                .Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    fun write(secret: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        file.writeBytes(byteArrayOf(c.iv.size.toByte()) + c.iv + c.doFinal(secret.toByteArray()))
    }

    fun read(): String? =
        runCatching {
            val b = file.readBytes()
            val ivLen = b[0].toInt()
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b, 1, ivLen))
            String(c.doFinal(b, 1 + ivLen, b.size - 1 - ivLen))
        }.getOrNull()

    fun wipe() {
        file.delete()
    }

    private companion object {
        const val ALIAS = "locarc-receiver-secret"
    }
}

/** Manual wiring: one object builds the driver, clock, engine and the Android adapters. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppGraph(
    private val app: Application,
) {
    val secrets = SecretStore(File(app.filesDir, "secret.bin"))
    val pairing = StateFile(File(app.filesDir, "pairing.json"))
    val driver = UsbHackRf(app.getSystemService(UsbManager::class.java))

    /** One thread owns every engine state change; DSP runs on its own. */
    val engineDispatcher = Executors.newSingleThreadExecutor { Thread(it, "engine") }.asCoroutineDispatcher()
    private val dspDispatcher =
        Executors
            .newSingleThreadExecutor {
                Thread(it, "dsp").apply { priority = Thread.MAX_PRIORITY - 1 }
            }.asCoroutineDispatcher()
    val scope = CoroutineScope(SupervisorJob() + engineDispatcher)

    private val _engine = MutableStateFlow<Engine?>(null)
    val engine: StateFlow<Engine?> = _engine.asStateFlow()

    val conditions = PhoneConditions(app)
    val location = LocationFeed(app)
    val control = ControlFeed(app)
    val updater = Updater(app)

    val deploymentUrl: String? get() = pairing.getString("deploymentUrl")
    val receiverName: String? get() = pairing.getString("name")
    val paired: Boolean get() = deploymentUrl != null && secrets.read() != null

    init {
        if (paired) startEngine()
    }

    /** Redeems a pairing code; the secret goes to the Keystore, the rest to a small file. */
    suspend fun pair(
        deploymentUrl: String,
        code: String,
    ): Paired {
        val http = ConvexHttp(deploymentUrl, UrlConnectionTransport())
        val paired = ReceiverAuth(http, Clock { System.currentTimeMillis() }) { null }.pair(code.trim().uppercase())
        secrets.write(paired.secret)
        pairing.put(mapOf("deploymentUrl" to deploymentUrl, "receiverId" to paired.receiverId, "name" to paired.name))
        startEngine()
        return paired
    }

    @Synchronized
    fun startEngine(): Engine {
        _engine.value?.let { return it }
        val url = deploymentUrl ?: error("not paired")
        val info = app.packageManager.getPackageInfo(app.packageName, 0)
        val e =
            Engine(
                driver = driver,
                localClock = Clock { System.currentTimeMillis() },
                dir = File(app.filesDir, "engine"),
                deploymentUrl = url,
                transport = UrlConnectionTransport(),
                secret = { secrets.read() },
                appVersion = info.versionName ?: "dev",
                appVersionCode = info.longVersionCode.toInt(),
                scope = scope,
                radio = dspDispatcher,
                onRemoved = { forget() },
                onRelease = { updater.offer(it) },
            )
        _engine.value = e
        e.start()
        conditions.start { e.onConditions(it) }
        location.start { e.onLocation(it) }
        control.start(url, e)
        CrashReporter.flush(app) { e.reportError(it) }
        return e
    }

    /** Removed on the website: stop, wipe the secret and go back to pairing. */
    fun forget() {
        control.stop()
        location.stop()
        conditions.stop()
        _engine.value?.shutdown()
        _engine.value = null
        secrets.wipe()
        pairing.clear()
        ScanService.stop(app)
    }

    fun report(e: ErrorReport) {
        _engine.value?.reportError(e)
    }
}
