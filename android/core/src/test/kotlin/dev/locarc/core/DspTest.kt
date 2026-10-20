package dev.locarc.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DspTest {
    private val plan = SweepPlan(listOf(Segment(400_000_000, 420_000_000)), 12_500)
    private val tuning = Tuning(32, 30, false, 0.0, 0.0)

    private fun ch(hz: Double) = Math.round(hz / 12_500)

    private fun window(
        tones: List<Tone>,
        ms: Long = 10_000,
        fixMs: Long = 10_000,
        t: Tuning = tuning,
        synth: Synth = Synth(),
    ): WindowResult {
        val p = SweepProcessor(plan)
        p.startWindow(t, fixMs)
        synth.run(p, plan, tones, 0, ms)
        return p.finish()
    }

    @Test
    fun `the FFT puts a tone in its bin`() {
        val n = 2048
        val fft = Fft(n)
        val re = FloatArray(n) { cos(2 * PI * 37 * it / n).toFloat() }
        val im = FloatArray(n) { sin(2 * PI * 37 * it / n).toFloat() }
        fft.transform(re, im)
        val peak = (0 until n).maxBy { re[it] * re[it] + im[it] * im[it] }
        assertEquals(37, peak)
    }

    @Test
    fun `the noise floor reads the true mean noise per Channel`() {
        val r = window(emptyList())
        // Complex noise of 2 counts RMS per rail: −33.1 dBFS over 20 MHz; Hann ENBW 1.5 bins;
        // 1.28 bins of 9.77 kHz per 12.5 kHz Channel; minus 62 dB of gain.
        val expected = 10 * kotlin.math.log10(8.0 / 16384 * 1.5 / 2048 * 1.28) - 62
        val floors = r.payload.slices.map { it.floorDbm }
        println("floors ${floors.map { "%.2f".format(it) }} expected %.2f".format(expected))
        floors.forEach { assertTrue(abs(it - expected) < 1.5, "floor $it vs $expected") }
        // Passes start every 150 ms from 0: 67 of them begin inside 10 s.
        assertEquals(67, r.fixPasses)
    }

    @Test
    fun `a tone becomes one narrow Emitter at its Channel, gain-compensated`() {
        val f = 403.0125e6
        val r = window(listOf(Tone(f, 10.0)))
        val e = r.payload.emitters.single()
        assertEquals(ch(f), e.strongestCh)
        assertTrue(e.widthCh <= 6, "width ${e.widthCh}")
        // 10 counts of 128: −22.1 dBFS; LNA 32 + VGA 30.
        val power = assertNotNull(e.fixPowerDbm)
        assertTrue(abs(power - (-22.1 - 62)) < 3, "power $power")
        assertTrue(e.passesOn >= 60, "passes on ${e.passesOn}")
    }

    @Test
    fun `two narrow transmitters 100 kHz apart stay two Emitters, a wide one stays one`() {
        val r =
            window(
                listOf(
                    Tone(402.0e6, 2.0),
                    Tone(402.1e6, 2.0),
                    Tone(412.5e6, 6.0, bandwidthHz = 1_000_000.0),
                ),
                ms = 3_000,
            )
        val narrow = r.payload.emitters.filter { it.firstCh < ch(410e6) }
        assertEquals(listOf(ch(402.0e6), ch(402.1e6)), narrow.map { it.strongestCh })
        val wide =
            r.payload.emitters
                .filter { it.firstCh > ch(410e6) }
                .single()
        assertTrue(wide.widthCh in 60..100, "wide ${wide.widthCh}")
    }

    @Test
    fun `a burst after the Fix window has no Fix power but a peak and passes on`() {
        val f = 413.0125e6
        val r = window(listOf(Tone(f, 10.0, on = { it >= 12_000 })), ms = 20_000)
        val e = r.payload.emitters.single()
        assertNull(e.fixPowerDbm)
        assertEquals(ch(f), e.strongestCh)
        assertTrue(e.passesOn in 40..60, "passes on ${e.passesOn} of ${r.passes}")
    }

    @Test
    fun `noise alone gives no Emitter over 2,000 passes`() {
        val p = SweepProcessor(plan)
        p.startWindow(tuning, 10_000)
        Synth(seed = 7).run(p, plan, emptyList(), 0, 2000L * 150)
        val r = p.finish()
        assertEquals(2000, r.passes)
        assertEquals(emptyList(), r.payload.emitters)
    }

    @Test
    fun `ppm correction names the Channel the transmitter is really on`() {
        val f = 403.0125e6
        val seen = f * (1 + 40e-6)
        val corrected = window(listOf(Tone(seen, 10.0)), t = tuning.copy(ppm = 40.0))
        assertEquals(
            ch(f),
            corrected.payload.emitters
                .single()
                .strongestCh,
        )
        val raw = window(listOf(Tone(seen, 10.0)))
        assertEquals(
            ch(f) + 1,
            raw.payload.emitters
                .single()
                .strongestCh,
        )
    }

    @Test
    fun `the HackRF's 20 MHz clock spurs are masked`() {
        val r = window(listOf(Tone(400.0125e6, 10.0)))
        assertEquals(emptyList(), r.payload.emitters)
    }

    @Test
    fun `clipping flags the slice and the Emitter`() {
        val r = window(listOf(Tone(403.0125e6, 300.0)), ms = 1_000)
        assertTrue(r.payload.slices[0].clippedFix)
        assertTrue(r.payload.emitters.any { it.clippedFix })
    }

    @Test
    fun `unusable blocks are faults`() {
        val p = SweepProcessor(plan)
        p.startWindow(tuning, 10_000)
        val zero =
            ByteArray(SweepProcessor.BLOCK_BYTES).also {
                it[0] = 0x7F
                it[1] = 0x7F
            }
        assertEquals(Fault.ZERO_BUFFER, p.block(zero, 0, zero.size, 0))
        val noMarker = Synth().block(400_000_000, emptyList(), 0).also { it[0] = 0 }
        assertEquals(Fault.TRANSFER_ERROR, p.block(noMarker, 0, noMarker.size, 0))
        val dcOnly = zero.copyOf().also { b -> for (i in 16 until b.size) b[i] = 5 }
        assertEquals(Fault.DC_ONLY, p.block(dcOnly, 0, dcOnly.size, 0))
        assertEquals(Fault.SHORT_READ, p.block(zero, 0, 100, 0))
    }

    // The committed real captures (laptop HackRF, single tunes)

    private fun capture(name: String): WindowResult {
        val meta = Json.parseToJsonElement(javaClass.getResource("/captures/$name.json")!!.readText()).jsonObject
        val iq = javaClass.getResource("/captures/$name.iq8")!!.readBytes()
        val rate = (meta["sampleRateHz"] ?: meta["sampleRate"])!!.jsonPrimitive.doubleOrNull!!.toInt()
        val center =
            meta
                .getValue("centerHz")
                .jsonPrimitive.doubleOrNull!!
                .toLong()
        val narrow = rate < 20_000_000
        // At 10 MS/s keep 0.5–4.5 MHz either side of the tune; at 20 MS/s the sweep geometry.
        val offset = if (narrow) 5_000_000L else SweepProcessor.TUNE_OFFSET_HZ
        val plan = SweepPlan(listOf(Segment(center - offset, center + offset)), 12_500)
        val p =
            if (narrow) {
                SweepProcessor(plan, rate, offset, 500_000.0, 4_500_000.0)
            } else {
                SweepProcessor(plan, rate)
            }
        p.startWindow(Tuning(32, 30, false, 0.0, 0.0), Long.MAX_VALUE)
        val block = ByteArray(SweepProcessor.BLOCK_BYTES)
        val header =
            ByteBuffer
                .allocate(10)
                .order(ByteOrder.LITTLE_ENDIAN)
                .put(0x7F)
                .put(0x7F)
                .putLong(center - offset)
                .array()
        val used = 2 * SweepProcessor.SAMPLES_USED
        var i = 0
        while (i + used <= iq.size) {
            block.fill(0)
            header.copyInto(block)
            iq.copyInto(block, block.size - used, i, i + used)
            p.block(block, 0, block.size, 0)
            i += used
        }
        return p.finish()
    }

    private fun WindowResult.covers(mhz: Double) =
        payload.emitters.any {
            mhz * 1e6 / 12_500 in
                (it.firstCh - 8).toDouble()..(it.firstCh + it.widthCh + 8).toDouble()
        }

    @Test
    fun `FM broadcast, two stations, each one Emitter about 200 kHz wide`() {
        val r = capture("fm-99.000MHz-l32-g30")
        println("fm: ${r.payload.emitters.map { "${it.strongestCh * 12.5 / 1000} MHz ×${it.widthCh}" }}")
        assertTrue(r.covers(98.0) && r.covers(100.4), "FM stations not found")
        assertTrue(
            r.payload.emitters
                .filter { it.widthCh > 3 }
                .all { it.widthCh in 4..40 },
        )
    }

    @Test
    fun `GSM, its carriers are found`() {
        val r = capture("gsm-955.000MHz-l32-g34")
        println("gsm: ${r.payload.emitters.map { "${it.strongestCh * 12.5 / 1000} MHz ×${it.widthCh}" }}")
        assertTrue(r.covers(956.38), "GSM carrier near 956.38 MHz not found")
    }

    @Test
    fun `the clipped GSM capture is flagged`() {
        val r = capture("gsm-955.000MHz-l32-g30-clipped")
        assertTrue(r.payload.slices.any { it.clippedFix })
    }

    @Test
    fun `quiet captures give no Emitters, DC spike and all`() {
        for (name in listOf("quiet-433.920MHz-l32-g34", "phone-quiet-433.920MHz-l16-g20")) {
            val r = capture(name)
            println("$name: ${r.payload.emitters.map { "${it.strongestCh * 12.5 / 1000} MHz ×${it.widthCh}" }}")
            assertEquals(emptyList(), r.payload.emitters, name)
        }
    }

    @Test
    fun `the 20 MS per s capture near 434 MHz holds one steady narrow carrier near 428 MHz`() {
        // Outside the 10 MS/s captures' view; on in every pass at LNA 32 / VGA 40.
        val r = capture("quiet-433.920MHz-20M-l32-g40")
        val e = r.payload.emitters.single()
        assertEquals(Math.round(428.4375e6 / 12_500), e.strongestCh)
        assertTrue(e.widthCh <= 2)
        assertEquals(r.passes, e.passesOn)
    }

    @Test
    fun `the 20 MS per s GSM capture runs through the sweep geometry without faults`() {
        val r = capture("gsm-955.000MHz-20M-l32-g40")
        assertEquals(2, r.payload.slices.count { it.floorDbm > SweepProcessor.NO_FLOOR_DBM })
    }

    @Test
    fun `a carrier meter finds the reference's power and offset`() {
        val ref = 433.92e6
        val m = CarrierMeter(ref)
        val n = 65_536 * 4
        val iq = ByteArray(2 * n)
        val offsetHz = 1_000_000 + 1_234.0
        val rand = java.util.Random(3)
        for (i in 0 until n) {
            val ph = 2 * PI * offsetHz * i / 10_000_000
            iq[2 * i] = (20 * cos(ph) + rand.nextGaussian() * 2).toInt().coerceIn(-128, 127).toByte()
            iq[2 * i + 1] = (20 * sin(ph) + rand.nextGaussian() * 2).toInt().coerceIn(-128, 127).toByte()
        }
        m.samples(iq, 0, n)
        val (power, freq) = assertNotNull(m.result(0.0))
        assertTrue(abs(freq - 1_234.0) < 100, "offset $freq")
        // 20 counts of 128: −16.1 dBFS.
        assertTrue(abs(power - (-16.1)) < 1.5, "power $power")
    }
}
