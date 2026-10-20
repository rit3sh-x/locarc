package dev.locarc.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes

/**
 * The whole engine on the JVM: a fake HackRF, a fake backend over HTTP, virtual time. Nothing
 * inside the engine is mocked.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EngineTest {
    /** Server time at the test's start; the phone's own clock can be set off by days. */
    private val t0 = 1_792_411_200_000L
    private val tone = 412.5125e6
    private val plan = SweepPlan(listOf(Segment(400_000_000, 420_000_000)), 12_500)

    private inner class World(
        val scope: TestScope,
        skewMs: Long = 0,
    ) {
        val dir = Files.createTempDirectory("engine").toFile()
        val server = { t0 + scope.testScheduler.currentTime }
        val local = Clock { t0 + scope.testScheduler.currentTime + skewMs }
        val hackrf = FakeHackRf(server, listOf(Tone(tone, 10.0)))
        val backend = FakeBackend(server)
        var removed = false
        val engine = make()

        fun make() =
            Engine(
                driver = hackrf,
                localClock = local,
                dir = dir,
                deploymentUrl = "https://test.convex.cloud",
                transport = backend,
                secret = { "s3cret" },
                appVersion = "1.0.0",
                appVersionCode = 100,
                scope = scope.backgroundScope,
                radio = StandardTestDispatcher(scope.testScheduler),
                onRemoved = { removed = true },
            )

        /** A Continuous Run (15 s Scans) starting at the next whole minute of server time. */
        fun run(
            paused: Boolean = false,
            configV: Int = 1,
            lna: Int = 32,
        ) = ControlDoc(
            run =
                RunInfo(
                    runId = "run1",
                    number = 1,
                    startsAt = (server() / 60_000 + 1) * 60_000,
                    periodMs = 15_000,
                    plan = plan,
                    fixWindowMs = 10_000,
                    uploadMarginMs = 3_000,
                    burstEndsAt = null,
                ),
            paused = paused,
            configV = configV,
            config = ReceiverConfig("Gate 2", lna, 30, false, 0.0, 0.0, null),
            commands = emptyList(),
            release = null,
        )
    }

    private fun TestScope.world(skewMs: Long = 0) = World(this, skewMs).also { it.engine.start() }

    @Test
    fun `a whole Scan, the window's Reading reaches the backend with the tone as an Emitter`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run())
            advanceTimeBy(2.minutes)
            val r = w.backend.readings().first()
            assertEquals("run1", r.runId)
            assertNull(r.stopReason)
            assertEquals(12_000, r.windowMs)
            assertTrue(r.fixPasses > 100, "fix passes ${r.fixPasses}")
            val e = ReadingCodec.decode(r.payload).emitters.single()
            assertEquals(Math.round(tone / 12_500), e.strongestCh)
            // Readings follow the Run's boundaries on the server's clock.
            val k = r.k
            assertEquals(w.run().run!!.boundary(k), w.run().run!!.boundary(k))
            val hb =
                w.backend.syncs
                    .last()
                    .getValue("heartbeat")
                    .jsonObject
            assertEquals("streaming", hb.getValue("hackrf").jsonObject.s("state"))
        }

    @Test
    fun `a phone clock 20 days off is corrected by the first sync`() =
        runTest {
            val w = world(skewMs = -20L * 24 * 3_600_000)
            advanceTimeBy(1_000)
            assertTrue(kotlin.math.abs(w.engine.clock.now() - w.server()) < 50, "corrected clock")
            w.engine.onControl(w.run())
            advanceTimeBy(2.minutes)
            val first = w.backend.readings().first()
            // Its window started on a server-time boundary, so k is a real Scan of the Run.
            assertTrue(first.k >= 0)
            assertTrue(first.clockUncertaintyMs < 100, "uncertainty ${first.clockUncertaintyMs}")
        }

    @Test
    fun `an unplugged HackRF cuts the window short and says why, the next window waits for it`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run())
            advanceTimeBy(66_000)
            w.hackrf.detached = true
            advanceTimeBy(30_000)
            val cut = w.backend.readings().last()
            assertEquals("DETACHED", cut.stopReason)
            assertTrue(cut.windowMs < 12_000)
            val hb =
                w.backend.syncs
                    .last()
                    .getValue("heartbeat")
                    .jsonObject
                    .getValue("hackrf")
                    .jsonObject
            assertEquals("detached", hb.s("state"))
            w.hackrf.detached = false
            w.engine.onAttached()
            advanceTimeBy(40_000)
            assertNull(
                w.backend
                    .readings()
                    .last()
                    .stopReason,
            )
        }

    @Test
    fun `faults climb the ladder one level at a time, then Needs attention`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run())
            advanceTimeBy(64_000)
            repeat(5) { w.hackrf.failures.addLast(Fault.TRANSFER_ERROR) }
            advanceTimeBy(30_000)
            assertEquals(1, w.hackrf.resets)
            assertEquals("Needs attention", w.engine.state.value.status)
            assertEquals(
                "NEEDS_ATTENTION",
                w.backend
                    .readings()
                    .last()
                    .stopReason,
            )
            // Nothing more until a replug.
            advanceTimeBy(60_000)
            assertEquals(
                "NEEDS_ATTENTION",
                w.backend
                    .readings()
                    .last()
                    .stopReason,
            )
            w.engine.onAttached()
            advanceTimeBy(40_000)
            assertNull(
                w.backend
                    .readings()
                    .last()
                    .stopReason,
            )
        }

    @Test
    fun `old firmware is Needs attention with its own fault on every heartbeat`() =
        runTest {
            val w = world()
            w.hackrf.info = w.hackrf.info.copy(firmware = "2014.08.1", usbApi = 0x0100)
            w.engine.onControl(w.run())
            advanceTimeBy(2.minutes)
            assertEquals("update the HackRF firmware", w.engine.state.value.reason)
            val faults =
                w.backend.syncs
                    .last()
                    .getValue("heartbeat")
                    .jsonObject
                    .getValue("hackrf")
                    .jsonObject
                    .getValue("faults")
                    .jsonObject
            assertTrue(faults.containsKey("FIRMWARE_UNSUPPORTED"))
            assertEquals(emptyList(), w.backend.readings())
        }

    @Test
    fun `an Operator pause sends what the window heard, then stops the radio`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run())
            advanceTimeBy(64_000)
            w.engine.onControl(w.run(paused = true))
            advanceTimeBy(30_000)
            assertEquals(
                "paused",
                w.backend
                    .readings()
                    .last()
                    .stopReason,
            )
            assertNull(w.hackrf.plan)
            assertEquals("Paused", w.engine.state.value.status)
        }

    @Test
    fun `config pushes apply or are rejected with a reason`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run(configV = 2, lna = 24))
            advanceTimeBy(2.minutes)
            assertEquals(
                24,
                w.backend
                    .readings()
                    .first()
                    .lnaDb,
            )
            w.engine.onControl(w.run(configV = 3, lna = 33))
            advanceTimeBy(5_000)
            val hb =
                w.backend.syncs
                    .last()
                    .getValue("heartbeat")
                    .jsonObject
            assertEquals(2.0, hb.d("appliedConfigV"))
            assertTrue(
                hb
                    .getValue("rejectedConfig")
                    .jsonObject
                    .s("reason")!!
                    .contains("LNA 33"),
            )
        }

    @Test
    fun `on battery the window is the Fix window only, low battery self-pauses`() =
        runTest {
            val w = world()
            w.engine.onConditions(Conditions(battery = 0.6, charging = false))
            w.engine.onControl(w.run())
            advanceTimeBy(2.minutes)
            assertEquals(
                10_000,
                w.backend
                    .readings()
                    .first()
                    .windowMs,
            )
            val window =
                w.backend.syncs
                    .last()
                    .getValue("heartbeat")
                    .jsonObject
                    .getValue("window")
                    .jsonObject
            assertEquals("short", window.s("mode"))
            assertEquals("battery", window.s("reason"))
            w.engine.onConditions(Conditions(battery = 0.15, charging = false))
            advanceTimeBy(1.minutes)
            assertEquals("Paused", w.engine.state.value.status)
            assertEquals(
                "battery",
                w.backend.syncs
                    .last()
                    .getValue("heartbeat")
                    .jsonObject
                    .s("selfPause"),
            )
        }

    @Test
    fun `a removed Receiver stops, forgets everything and says so`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run())
            advanceTimeBy(2.minutes)
            w.backend.revoked = true
            w.engine.auth.forget()
            w.engine.requestSync()
            advanceTimeBy(10_000)
            assertTrue(w.removed)
            assertTrue(w.engine.state.value.removed)
        }

    @Test
    fun `the outbox keeps Readings through outages and drains them, newest first`() =
        runTest {
            val w = world()
            w.backend.failSyncs = 1_000
            w.engine.onControl(w.run())
            advanceTimeBy(5.minutes)
            assertEquals(0, w.backend.syncs.size)
            assertTrue(w.engine.state.value.outboxDepth >= 10, "depth ${w.engine.state.value.outboxDepth}")
            w.backend.failSyncs = 0
            advanceTimeBy(10.minutes)
            val ks = w.backend.readings().map { it.k }
            assertTrue(ks.size >= 15, "drained ${ks.size}")
            assertEquals(ks.toSet().size, ks.size, "each Reading once")
        }

    @Test
    fun `Readings older than 24 hours are dropped and counted`() =
        runTest {
            val w = world()
            w.backend.failSyncs = 100_000
            w.engine.onControl(w.run())
            advanceTimeBy(80_000)
            w.engine.onControl(w.run(paused = true))
            advanceTimeBy(25.hours)
            w.backend.failSyncs = 0
            w.engine.requestSync()
            advanceTimeBy(10.minutes)
            val hb =
                w.backend.syncs
                    .first()
                    .getValue("heartbeat")
                    .jsonObject
                    .getValue("outbox")
                    .jsonObject
            assertTrue(hb.d("dropped")!! >= 1.0)
            assertEquals(emptyList(), w.backend.readings())
        }

    @Test
    fun `a calibration command measures the carrier, reports it and acks`() =
        runTest {
            val w = world()
            w.engine.onControl(w.run())
            advanceTimeBy(70_000)
            val cal = w.run().copy(commands = listOf(Command(1, "calibrate", "session1", 433.92e6, 30.0, "full")))
            w.engine.onControl(cal)
            advanceTimeBy(2.minutes)
            val withCal = w.backend.syncs.first { it.containsKey("calibration") }
            val c = withCal.getValue("calibration").findSession("session1")
            assertNotNull(c)
            assertEquals(1.0, withCal.d("ackSeq"))
            // Scanning resumes afterwards.
            val after = w.backend.readings().last()
            assertNull(after.stopReason)
        }

    private fun kotlinx.serialization.json.JsonElement.findSession(session: String) =
        (this as kotlinx.serialization.json.JsonArray).map { it.jsonObject }.firstOrNull { it.s("session") == session }
}
