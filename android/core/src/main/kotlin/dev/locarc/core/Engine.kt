package dev.locarc.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// The HackRF, as the engine sees it. :app implements it over Android's USB host API.

class Transfer(
    val data: ByteArray,
    val length: Int,
)

class HackRfException(
    val fault: Fault,
    message: String,
) : Exception(message)

data class DeviceInfo(
    val boardId: Int,
    val firmware: String,
    val serial: String,
    val usbApi: Int,
) {
    /** Sweep mode needs firmware with USB API 0x0102 or later (libhackrf's own check). */
    val canSweep: Boolean get() = usbApi >= 0x0102
}

interface HackRfDriver {
    /** Opens the device. Throws HackRfException (PERMISSION_DENIED, DETACHED, OPEN_FAILED). */
    suspend fun open(): DeviceInfo

    suspend fun configure(
        t: Tuning,
        sampleRate: Int,
    )

    /** INIT_SWEEP over the plan's segments, then receive-sweep mode: 16 KiB header-tagged blocks. */
    suspend fun startSweep(plan: SweepPlan)

    /** Plain receive at a fixed frequency (calibration): raw int8 IQ, no headers. */
    suspend fun startReceive(centerHz: Long)

    /** The next transfer, or null on a timeout. Throws HackRfException(DETACHED) once unplugged. */
    suspend fun read(): Transfer?

    /** Transceiver off. */
    suspend fun stop()

    /** Cancels in-flight transfers, reaps them, then closes. */
    suspend fun close()

    /** Vendor RESET; the device re-enumerates. */
    suspend fun reset()
}

/** What the phone reports about itself; :app collects it from Android. */
data class Conditions(
    val battery: Double = 1.0,
    val charging: Boolean = true,
    val thermal: String = "none",
    val setupGaps: List<String> = emptyList(),
)

/** Everything Status shows, as one immutable snapshot. */
data class ReceiverState(
    val status: String = "Starting",
    val reason: String? = null,
    val run: RunInfo? = null,
    val scanK: Long? = null,
    val nextBoundary: Long? = null,
    val hackrf: String = "detached",
    val device: DeviceInfo? = null,
    val position: PositionFix? = null,
    val pinned: Boolean = false,
    val outboxDepth: Int = 0,
    val conditions: Conditions = Conditions(),
    val window: WindowMode = WindowMode("full", null),
    val clockUncertaintyMs: Double = ClockSync.UNKNOWN_MS,
    val lastEmitters: List<EmitterRecord> = emptyList(),
    val lastPasses: Int = 0,
    val rasterHz: Long = 12_500,
    val board: BoardEnvelope? = null,
    val fleet: List<FleetMember> = emptyList(),
    val removed: Boolean = false,
    val tooOld: Boolean = false,
    val lastSyncAt: Long? = null,
    val lastError: String? = null,
)

private val THERMAL = listOf("none", "light", "moderate", "severe", "critical", "emergency", "shutdown")

private fun thermalAtLeast(
    t: String,
    level: String,
) = THERMAL.indexOf(t) >= THERMAL.indexOf(level)

class Engine(
    private val driver: HackRfDriver,
    localClock: Clock,
    dir: File,
    deploymentUrl: String,
    transport: HttpTransport,
    secret: () -> String?,
    private val appVersion: String,
    private val appVersionCode: Int,
    private val scope: CoroutineScope,
    private val radio: CoroutineDispatcher,
    private val onRemoved: () -> Unit = {},
    private val onRelease: (Release) -> Unit = {},
) {
    private val local = localClock
    val clock = ClockSync(localClock)
    private val outbox = Outbox(File(dir, "outbox"), clock)
    private val stateFile = StateFile(File(dir, "state.json"))
    val auth = ReceiverAuth(ConvexHttp(deploymentUrl, transport), clock, secret)
    private val sync = SyncClient(ConvexHttp(deploymentUrl, transport), auth)

    private val _state = MutableStateFlow(ReceiverState())
    val state: StateFlow<ReceiverState> = _state.asStateFlow()

    // Control and config.
    private var control: ControlDoc? = null
    private var accepted: Pair<Int, ReceiverConfig>? = null
    private var rejected: Pair<Int, String>? = null
    private var handledSeq = stateFile.getLong("handledSeq")?.toInt() ?: 0
    private var ackSent = stateFile.getLong("ackSent")?.toInt() ?: 0
    private var conditions = Conditions()
    private var selfPause: String? = null

    // Position.
    private var position: PositionFix? = null
    private var sentPosition: PositionFix? = null
    private var pendingPosition: PositionFix? = null

    // HackRF.
    private var device: DeviceInfo? = null
    private var sweeping: SweepPlan? = null
    private var configured: Tuning? = null
    private var hackrfState = "detached"
    private var ladder = 0
    private var ladderMax = 0
    private var cleanSince = 0L
    private val faults = mutableMapOf<String, Int>()
    private var detachedSince: Long? = null
    private val detaches = ArrayDeque<Long>()
    private var flapBackoff = 0
    private var processor: SweepProcessor? = null

    /** The ladder ran out: nothing more until someone replugs the HackRF. */
    private var needsReplug = false

    // Readings and sync.
    private var clippedHz = listOf<Double>()
    private var dropped = 0
    private var boardAt = stateFile.getLong("boardAt")
    private var fleetAt = stateFile.getLong("fleetAt")
    private var lastError: String? = null
    private val syncNow = Channel<Unit>(Channel.CONFLATED)
    private var scanJob: Job? = null
    private var scanKey: String? = null
    private var interrupt: String? = null
    private var inWindow = false
    private var calibrating = false
    private var stopped = false

    init {
        val off = stateFile.getDouble("clockOffset")
        val unc = stateFile.getDouble("clockUncertainty")
        val at = stateFile.getLong("clockAt")
        if (off != null && unc != null && at != null) clock.restore(off, unc, at)
    }

    fun start() {
        scope.launch { syncLoop() }
        requestSync()
        publish()
    }

    fun shutdown() {
        stopped = true
        scanJob?.cancel()
        scope.launch { runCatching { driver.stop() } }
    }

    fun requestSync() {
        syncNow.trySend(Unit)
    }

    // Inputs from :app

    fun onControl(doc: ControlDoc?) =
        scope.launch {
            if (doc == null || stopped) return@launch
            control = doc
            if (accepted?.first != doc.configV && rejected?.first != doc.configV) {
                val problem = doc.config.problem()
                if (problem == null) {
                    accepted = doc.configV to doc.config
                    rejected = null
                } else {
                    rejected = doc.configV to problem
                }
            }
            for (c in doc.commands.sortedBy { it.seq }) if (c.seq > handledSeq && c.kind == "calibrate") calibrate(c)
            doc.release?.let { if (it.versionCode > appVersionCode) onRelease(it) }
            reconcile()
            // Any Operator action (Start, a config push, a pause) is answered at once.
            requestSync()
            publish()
        }

    fun onLocation(fix: PositionFix) =
        scope.launch {
            position = fix
            val last = sentPosition
            val push =
                last == null ||
                    distanceM(last.lat, last.lng, fix.lat, fix.lng) > max(10.0, fix.accuracyM) ||
                    fix.accuracyM * 2 <= last.accuracyM
            if (push && (last == null || fix.at - last.at >= POSITION_MIN_MS)) {
                pendingPosition = fix
                requestSync()
            }
            publish()
        }

    fun onConditions(c: Conditions) =
        scope.launch {
            conditions = c
            val before = selfPause
            selfPause =
                when {
                    thermalAtLeast(c.thermal, "severe") -> "thermal"
                    c.battery < 0.2 && !c.charging -> "battery"
                    // Resumes at 30%, not 20%, so a phone on the edge doesn't flap.
                    before == "battery" && c.battery < 0.3 && !c.charging -> "battery"
                    else -> null
                }
            if (selfPause != before) {
                reconcile()
                requestSync()
            }
            publish()
        }

    /** The HackRF was plugged in; it is opened at the next boundary. */
    fun onAttached() {
        scope.launch {
            if (needsReplug) {
                needsReplug = false
                ladder = 0
                runCatching { driver.close() }
                device = null
            }
            if (hackrfState == "needs_attention" || hackrfState == "needs_permission") hackrfState = "detached"
            publish()
        }
    }

    fun reportError(e: ErrorReport) =
        scope.launch {
            outbox.putError(e)
            publish()
        }

    // Scanning

    private fun shouldScan(): RunInfo? {
        val doc = control ?: return null
        if (doc.paused || selfPause != null || calibrating || _state.value.removed || _state.value.tooOld) return null
        return doc.run
    }

    /** Starts, keeps or stops the scan job to match the Run, pauses and phone conditions. */
    private suspend fun reconcile() {
        val run = shouldScan()
        val key = run?.let { "${it.runId}" }
        if (key == scanKey && (scanJob?.isActive == true || key == null)) return
        val previous = scanJob
        if (previous?.isActive == true) {
            // A pause or self-pause still sends what the window heard; a Run change drops it.
            if (inWindow && run == null && control?.run?.runId == scanKey) {
                interrupt = if (control?.paused == true) "paused" else "self-paused ($selfPause)"
                previous.join()
            } else {
                previous.cancelAndJoin()
            }
        }
        interrupt = null
        scanKey = key
        scanJob = null
        if (run == null) {
            runCatching { if (sweeping != null) driver.stop() }
            sweeping = null
            publish()
            return
        }
        scanJob = scope.launch { scanLoop(run) }
    }

    private fun shortWindow(): Boolean = !conditions.charging || thermalAtLeast(conditions.thermal, "light")

    private suspend fun waitUntil(t: Long) {
        val ms = t - clock.now()
        if (ms > 0) delay(ms)
    }

    private suspend fun scanLoop(run: RunInfo) {
        // Join at the next boundary: never mid-window, never mixing Runs.
        var k = max(0, run.scanAt(clock.now()) + 1)
        while (scope.isActive && run.inRun(k) && interrupt == null) {
            val start = run.boundary(k)
            val next = run.boundary(k + 1)
            val end = if (shortWindow()) start + run.fixWindowMs else next - run.uploadMarginMs
            _state.update { it.copy(run = run, scanK = k, nextBoundary = start) }
            // The radio rests between windows when the gap is long.
            if (start - clock.now() > IDLE_RADIO_MS && sweeping != null) {
                runCatching { driver.stop() }
                sweeping = null
            }
            waitUntil(start - SETTLE_MS)
            val upload = window(run, k, start, end)
            if (upload != null) {
                outbox.putReading(upload)
                requestSync()
            }
            publish()
            if (upload?.stopReason != null && interrupt != null) break
            k++
        }
    }

    /** One Listening window; null when nothing was heard at all (e.g. no HackRF). */
    private suspend fun window(
        run: RunInfo,
        k: Long,
        start: Long,
        end: Long,
    ): ReadingUpload? {
        val cfg = accepted?.second
        val tuning = Tuning(cfg?.lnaDb ?: 32, cfg?.vgaDb ?: 30, cfg?.amp ?: false, cfg?.ppm ?: 0.0, cfg?.offsetDb ?: 0.0)
        if (!prepare(run.plan, tuning)) {
            waitUntil(end)
            return null
        }
        val proc = processor!!
        waitUntil(start)
        withContext(radio) { proc.startWindow(tuning, start + run.fixWindowMs) }
        inWindow = true
        try {
            return listen(run, k, start, end, tuning, proc)
        } finally {
            inWindow = false
        }
    }

    private suspend fun listen(
        run: RunInfo,
        k: Long,
        start: Long,
        end: Long,
        tuning: Tuning,
        proc: SweepProcessor,
    ): ReadingUpload? {
        val startPos = position
        var stopReason: String? = null
        hackrfState = "streaming"
        publish()
        var empty = 0
        while (clock.now() < end && !needsReplug) {
            interrupt?.let {
                stopReason = it
            }
            if (stopReason != null) break
            val t: Transfer? =
                try {
                    withTimeout(TRANSFER_TIMEOUT_MS) { driver.read() }
                } catch (e: TimeoutCancellationException) {
                    if (!fault(Fault.TRANSFER_TIMEOUT, run.plan, tuning)) stopReason = "NEEDS_ATTENTION"
                    continue
                } catch (e: HackRfException) {
                    if (e.fault == Fault.DETACHED) {
                        detached()
                        stopReason = "DETACHED"
                    } else if (!fault(e.fault, run.plan, tuning)) {
                        stopReason = "NEEDS_ATTENTION"
                    }
                    continue
                }
            if (t == null) {
                // One empty read is allowed; two in a row mean the stream has stalled.
                if (++empty >= 2) {
                    empty = 0
                    if (!fault(Fault.TRANSFER_TIMEOUT, run.plan, tuning)) stopReason = "NEEDS_ATTENTION"
                }
                continue
            }
            empty = 0
            val now = clock.now()
            val blockFaults =
                withContext(radio) {
                    val found = mutableListOf<Fault>()
                    var o = 0
                    while (o + SweepProcessor.BLOCK_BYTES <= t.length) {
                        proc.block(t.data, o, SweepProcessor.BLOCK_BYTES, now)?.let(found::add)
                        o += SweepProcessor.BLOCK_BYTES
                    }
                    if (t.length % SweepProcessor.BLOCK_BYTES != 0) found += Fault.SHORT_READ
                    found
                }
            if (blockFaults.isEmpty()) {
                if (ladder > 0 && now - cleanSince >= CLEAN_RESET_MS) ladder = 0
            } else {
                for (f in blockFaults.distinct()) if (!fault(f, run.plan, tuning)) stopReason = "NEEDS_ATTENTION"
            }
        }
        val result = withContext(radio) { proc.finish() }
        val listened = (min(clock.now(), end) - start).coerceAtLeast(0)
        clippedHz =
            result.payload.slices.mapIndexedNotNull { i, s ->
                if (s.clippedFix) run.plan.slices[i].let { (it.startHz + it.endHz) / 2.0 } else null
            }
        _state.update {
            it.copy(
                lastEmitters =
                    result.payload.emitters
                        .sortedByDescending { e ->
                            e.fixPowerDbm ?: e.peakDbm
                        }.take(20),
                lastPasses = result.passes,
                rasterHz = run.plan.rasterHz,
            )
        }
        if (result.passes == 0) return null
        return ReadingUpload(
            runId = run.runId,
            k = k,
            appVersion = appVersion,
            lnaDb = tuning.lnaDb,
            vgaDb = tuning.vgaDb,
            amp = tuning.amp,
            ppm = tuning.ppm,
            windowMs = listened,
            passes = result.passes,
            fixPasses = result.fixPasses,
            stopReason = stopReason,
            start = startPos,
            end = position,
            clockUncertaintyMs = clock.uncertaintyMs(),
            payload = ReadingCodec.encode(result.payload),
        )
    }

    /** Opens the HackRF if needed, applies gains and starts sweeping the plan. */
    private suspend fun prepare(
        plan: SweepPlan,
        tuning: Tuning,
    ): Boolean {
        if (needsReplug) return false
        if (device == null && !open()) return false
        if (device?.canSweep != true) return false
        try {
            if (configured != tuning) {
                driver.configure(tuning, SweepProcessor.SAMPLE_RATE)
                configured = tuning
            }
            if (sweeping != plan) {
                driver.startSweep(plan)
                sweeping = plan
            }
        } catch (e: HackRfException) {
            if (e.fault == Fault.DETACHED) detached() else fault(e.fault, plan, tuning)
            return false
        }
        if (processor?.plan != plan) processor = withContext(radio) { SweepProcessor(plan) }
        return true
    }

    private suspend fun open(): Boolean {
        // Power flapping backs off before trying again.
        if (flapBackoff > 0) {
            val wait = FLAP_BACKOFF_MS[min(flapBackoff, FLAP_BACKOFF_MS.size) - 1]
            if (clock.now() - (detaches.lastOrNull() ?: 0) < wait) return false
        }
        hackrfState = "opening"
        return try {
            val info = driver.open()
            device = info
            configured = null
            sweeping = null
            detachedSince = null
            if (!info.canSweep) {
                hackrfState = "needs_attention"
                count(Fault.FIRMWARE_UNSUPPORTED)
                requestSync()
                false
            } else {
                hackrfState = "ready"
                true
            }
        } catch (e: HackRfException) {
            val state = if (e.fault == Fault.PERMISSION_DENIED) "needs_permission" else "detached"
            if (state != hackrfState) requestSync()
            hackrfState = state
            if (e.fault != Fault.DETACHED) count(e.fault)
            false
        } finally {
            publish()
        }
    }

    private fun count(f: Fault) {
        faults[f.name] = (faults[f.name] ?: 0) + 1
    }

    private suspend fun detached() {
        val now = clock.now()
        count(Fault.DETACHED)
        runCatching { driver.close() }
        device = null
        sweeping = null
        hackrfState = "detached"
        detachedSince = detachedSince ?: now
        detaches.addLast(now)
        while (detaches.isNotEmpty() && now - detaches.first() > FLAP_WINDOW_MS) detaches.removeFirst()
        if (detaches.size >= FLAP_COUNT) {
            count(Fault.POWER_FLAPPING)
            flapBackoff++
        } else if (detaches.size == 1) {
            flapBackoff = 0
        }
        publish()
    }

    /**
     * One step up the recovery ladder: restart the sweep; transceiver off and on; close and
     * reopen; vendor reset. Returns false once it is exhausted ("replug the HackRF").
     */
    private suspend fun fault(
        f: Fault,
        plan: SweepPlan,
        tuning: Tuning,
    ): Boolean {
        count(f)
        cleanSince = clock.now()
        ladder++
        ladderMax = max(ladderMax, ladder)
        hackrfState = "recovering"
        publish()
        try {
            when (ladder) {
                1 -> driver.startSweep(plan)
                2 -> {
                    driver.stop()
                    driver.startSweep(plan)
                }
                3 -> {
                    driver.close()
                    device = null
                    if (!open()) return true
                    driver.configure(tuning, SweepProcessor.SAMPLE_RATE)
                    driver.startSweep(plan)
                }
                4 -> {
                    driver.reset()
                    device = null
                    delay(RESET_WAIT_MS)
                    if (!open()) {
                        count(Fault.RESET_FAILED)
                        hackrfState = "needs_attention"
                        needsReplug = true
                        requestSync()
                        return false
                    }
                    driver.configure(tuning, SweepProcessor.SAMPLE_RATE)
                    driver.startSweep(plan)
                }
                else -> {
                    hackrfState = "needs_attention"
                    needsReplug = true
                    runCatching { driver.stop() }
                    sweeping = null
                    requestSync()
                    return false
                }
            }
            sweeping = plan
            configured = tuning
            hackrfState = "streaming"
        } catch (e: HackRfException) {
            if (e.fault == Fault.DETACHED) detached() else count(e.fault)
        } finally {
            publish()
        }
        return true
    }

    // Calibration

    private suspend fun calibrate(c: Command) {
        calibrating = true
        val job = scanJob
        if (job?.isActive == true) {
            if (inWindow) {
                interrupt = "calibrating"
                job.join()
            } else {
                job.cancelAndJoin()
            }
            interrupt = null
            scanJob = null
            scanKey = null
        }
        val cfg = accepted?.second
        // Offset and ppm correction off: the measurement is raw.
        val tuning = Tuning(cfg?.lnaDb ?: 32, cfg?.vgaDb ?: 30, cfg?.amp ?: false, 0.0, 0.0)
        val meter = CarrierMeter(c.referenceHz)
        try {
            if (device == null && !open()) throw HackRfException(Fault.OPEN_FAILED, "no HackRF")
            driver.configure(tuning, CALIBRATION_RATE)
            configured = null
            driver.startReceive(meter.tunedHz)
            sweeping = null
            val until = clock.now() + (c.durationS * 1000).toLong()
            var spectra = 0
            while (clock.now() < until) {
                val t = withTimeoutOrNull(TRANSFER_TIMEOUT_MS) { driver.read() } ?: continue
                if (spectra < MAX_CAL_SPECTRA) {
                    withContext(radio) { meter.samples(t.data, 0, t.length / 2) }
                    spectra++
                }
            }
            driver.stop()
            meter.result(tuning.gainDb)?.let { (power, offset) ->
                outbox.putCalibration(CalibrationResult(c.session, power, offset))
            }
        } catch (e: HackRfException) {
            if (e.fault == Fault.DETACHED) detached() else count(e.fault)
        }
        handledSeq = c.seq
        calibrating = false
        stateFile.put(mapOf("handledSeq" to handledSeq))
        requestSync()
    }

    // Sync

    private suspend fun syncLoop() {
        var backoff = 0
        while (scope.isActive && !stopped) {
            val idle = if (scanJob?.isActive == true) SCANNING_SYNC_MS else IDLE_SYNC_MS
            val wait = if (backoff > 0) BACKOFF_MS[min(backoff, BACKOFF_MS.size) - 1] else idle
            withTimeoutOrNull(wait) { syncNow.receive() }
            if (stopped || _state.value.removed) return
            backoff =
                try {
                    var rounds = 0
                    var more = true
                    while (more && rounds++ < MAX_SYNC_ROUNDS) more = syncOnce()
                    0
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ConvexCallException) {
                    when (e.code) {
                        "REVOKED", "NOT_FOUND" -> {
                            removed()
                            return
                        }
                        "APP_TOO_OLD" -> {
                            _state.update { it.copy(tooOld = true) }
                            reconcile()
                            backoff + 1
                        }
                        else -> {
                            lastError = e.message
                            backoff + 1
                        }
                    }
                } catch (e: Exception) {
                    lastError = e.message
                    backoff + 1
                }
            publish()
        }
    }

    /** One sync call; true when more of the outbox is waiting. */
    private suspend fun syncOnce(): Boolean {
        dropped += outbox.expire()
        val batch = outbox.next()
        val ack = handledSeq.takeIf { it > ackSent }
        val position = pendingPosition ?: this.position?.takeIf { it != sentPosition }
        val req =
            SyncRequest(
                sentAt = clock.now(),
                heartbeat = heartbeat(),
                position = position,
                readings = batch.readings.map { it.second },
                ackSeq = ack,
                boardSince = boardAt,
                fleetSince = fleetAt,
                errors = batch.errors.map { it.second },
                calibration = batch.calibration.map { it.second },
            )
        val sent = clockLocalNow()
        val reply = sync.sync(req)
        clock.sample(sent, clockLocalNow(), reply.serverTime)
        val outcomes = reply.readings.associateBy { it.runId to it.k }
        for ((file, r) in batch.readings) if (outcomes.containsKey(r.runId to r.k)) file.delete()
        batch.calibration.forEach { it.first.delete() }
        batch.errors.forEach { it.first.delete() }
        if (ack != null) ackSent = ack
        if (position != null) {
            sentPosition = position
            pendingPosition = null
        }
        faults.clear()
        ladderMax = ladder
        dropped = 0
        reply.board?.let { b ->
            boardAt = b.at
            _state.update { it.copy(board = b) }
        }
        reply.fleet?.let { (at, items) ->
            fleetAt = at
            _state.update { it.copy(fleet = items) }
        }
        lastError = null
        val (off, unc, at) = clock.snapshot()
        stateFile.put(
            mapOf(
                "ackSent" to ackSent,
                "boardAt" to boardAt,
                "fleetAt" to fleetAt,
                "clockOffset" to off,
                "clockUncertainty" to unc,
                "clockAt" to at,
            ),
        )
        _state.update { it.copy(lastSyncAt = clock.now()) }
        return batch.readings.isNotEmpty() && outbox.next().readings.isNotEmpty()
    }

    private fun clockLocalNow() = local.now()

    private suspend fun removed() {
        scanJob?.cancel()
        runCatching { driver.stop() }
        outbox.clear()
        stateFile.clear()
        auth.forget()
        _state.update { it.copy(removed = true, status = "Removed", reason = "pair again") }
        onRemoved()
    }

    private fun heartbeat(): Heartbeat =
        Heartbeat(
            appVersion = appVersion,
            appVersionCode = appVersionCode,
            battery = conditions.battery,
            charging = conditions.charging,
            thermal = conditions.thermal,
            selfPause = selfPause,
            hackrf =
                HackRfStatus(
                    state = hackrfState,
                    serial = device?.serial,
                    boardId = device?.boardId,
                    firmware = device?.firmware,
                    ladder = ladderMax,
                    // Old firmware is reported on every heartbeat while it lasts.
                    faults =
                        if (device?.canSweep ==
                            false
                        ) {
                            faults + (Fault.FIRMWARE_UNSUPPORTED.name to max(1, faults[Fault.FIRMWARE_UNSUPPORTED.name] ?: 0))
                        } else {
                            faults.toMap()
                        },
                    detachedSince = detachedSince,
                ),
            clippedHz = clippedHz,
            window = heartbeatWindow(),
            setupGaps = conditions.setupGaps,
            outboxDepth = outbox.depth(),
            outboxOldestAgeS = outbox.oldestAgeS(),
            outboxDropped = dropped,
            clockOffsetMs = clock.offsetMs,
            clockUncertaintyMs = clock.uncertaintyMs(),
            gpsAccuracyM = position?.accuracyM,
            appliedConfigV = accepted?.first,
            rejectedConfig = rejected,
            lastError = lastError,
        )

    /** Status: state and its top reason, from what the engine knows locally. */
    private fun publish() {
        val doc = control
        val (status, reason) =
            when {
                _state.value.removed -> "Removed" to "pair again"
                _state.value.tooOld -> "Update required" to "this version is no longer supported"
                (faults[Fault.FIRMWARE_UNSUPPORTED.name] ?: 0) > 0 || device?.canSweep == false ->
                    "Needs attention" to
                        "update the HackRF firmware"
                hackrfState == "needs_attention" -> "Needs attention" to "replug the HackRF"
                hackrfState == "needs_permission" -> "Needs attention" to "allow USB access"
                doc?.run == null -> "Idle" to null
                doc.paused -> "Paused" to "paused by an Operator"
                selfPause == "battery" -> "Paused" to "battery low"
                selfPause == "thermal" -> "Paused" to "phone too hot"
                hackrfState == "detached" -> "Waiting" to "HackRF not connected"
                else -> "Scanning" to (if (shortWindow()) "short window" else null)
            }
        _state.update {
            it.copy(
                status = status,
                reason = reason,
                run = doc?.run,
                hackrf = hackrfState,
                device = device,
                position = position,
                pinned = doc?.config?.pinned != null,
                outboxDepth = outbox.depth(),
                conditions = conditions,
                window = heartbeatWindow(),
                clockUncertaintyMs = clock.uncertaintyMs(),
                lastError = lastError,
            )
        }
    }

    private fun heartbeatWindow() =
        if (shortWindow()) WindowMode("short", if (!conditions.charging) "battery" else "warm") else WindowMode("full", null)

    companion object {
        const val SETTLE_MS = 1_000L
        const val IDLE_RADIO_MS = 10_000L
        const val TRANSFER_TIMEOUT_MS = 500L
        const val CLEAN_RESET_MS = 60_000L
        const val RESET_WAIT_MS = 3_000L
        const val FLAP_WINDOW_MS = 120_000L
        const val FLAP_COUNT = 3
        val FLAP_BACKOFF_MS = longArrayOf(30_000, 120_000, 300_000)
        const val IDLE_SYNC_MS = 5 * 60_000L
        const val SCANNING_SYNC_MS = 15 * 60_000L
        val BACKOFF_MS = longArrayOf(5_000, 15_000, 60_000, 300_000)
        const val POSITION_MIN_MS = 15_000L
        const val CALIBRATION_RATE = 10_000_000
        const val MAX_CAL_SPECTRA = 200
        const val MAX_SYNC_ROUNDS = 10
    }
}

/** Great-circle distance in metres (equirectangular is plenty at these scales). */
fun distanceM(
    lat1: Double,
    lng1: Double,
    lat2: Double,
    lng2: Double,
): Double {
    val k = PI / 180
    val x = (lng2 - lng1) * k * cos((lat1 + lat2) / 2 * k)
    val y = (lat2 - lat1) * k
    return sqrt(x * x + y * y) * 6_371_000
}
