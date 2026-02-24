import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";

export const runtime = "nodejs";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

const controllerSettingsSchema = z.object({
    minFreqHz: z.number(),
    maxFreqHz: z.number(),
    sampleRate: z.number(),
    vgaGain: z.number(),
    lnaGain: z.number(),
    bufferSize: z.number(),
});

const controllerSchema = z.object({
    controllerId: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    settings: controllerSettingsSchema,
});

const sampleSchema = z.object({
    frequencyHz: z.number(),
    powerDbm: z.number(),
});

const measurementSchema = z.object({
    controllerId: z.string(),
    samples: z.array(sampleSchema),
});

const dispatchPayloadSchema = z.object({
    batchId: z.string().min(1),
    scanId: z.string().min(1),
    callbackUrl: z.url(),
    controllers: z.array(controllerSchema).min(1),
    measurements: z.array(measurementSchema).min(1),
});

type DispatchPayload = z.infer<typeof dispatchPayloadSchema>;

// ---------------------------------------------------------------------------
// Webhook response schema (what we will POST back to Convex)
// ---------------------------------------------------------------------------

interface WebhookLocation {
    centerLongitude: number;
    centerLatitude: number;
    bounds: { longitude: number; latitude: number }[];
}

interface WebhookResponse {
    batchId: string;
    scanId: string;
    locations: WebhookLocation[];
}

// ---------------------------------------------------------------------------
// POST /api/compute
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    // 1. Verify shared secret ------------------------------------------------
    const receivedSecret = request.headers.get("X-Webhook-Secret");
    if (!receivedSecret || !timingSafeEqual(receivedSecret, WEBHOOK_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Read & optionally verify HMAC signature -----------------------------
    const rawBody = await request.text();
    const signature = request.headers.get("X-Signature-256");

    if (signature) {
        const expectedSig = hmacSign(WEBHOOK_SECRET, rawBody);
        if (!timingSafeEqual(signature, expectedSig)) {
            return NextResponse.json(
                { error: "Invalid signature" },
                { status: 401 }
            );
        }
    }

    // 3. Parse & validate payload --------------------------------------------
    let json: unknown;
    try {
        json = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = dispatchPayloadSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Validation failed", details: parsed.error.flatten() },
            { status: 422 }
        );
    }

    const payload = parsed.data;

    // 4. Acknowledge receipt immediately – processing is async ----------------
    //    We fire-and-forget the compute + callback so the Convex action is not
    //    left waiting. If computation is fast you could also do it synchronously.
    setImmediate(() => void processAndCallback(payload));

    return NextResponse.json({ accepted: true }, { status: 202 });
}

// ---------------------------------------------------------------------------
// Compute + Callback
// ---------------------------------------------------------------------------

async function processAndCallback(payload: DispatchPayload): Promise<void> {
    try {
        const locations = await computeLocations(payload);

        const responseBody: WebhookResponse = {
            batchId: payload.batchId,
            scanId: payload.scanId,
            locations,
        };

        const body = JSON.stringify(responseBody);
        const signature = hmacSign(WEBHOOK_SECRET, body);

        const res = await fetch(payload.callbackUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Webhook-Secret": WEBHOOK_SECRET,
                "X-Signature-256": signature,
            },
            body,
        });

        if (!res.ok) {
            console.error(
                `[compute] Webhook callback failed for batch ${payload.batchId}: HTTP ${res.status}`
            );
        }
    } catch (error) {
        console.error(
            `[compute] Error processing batch ${payload.batchId}:`,
            error
        );
    }
}

// ---------------------------------------------------------------------------
// Compute logic
// ---------------------------------------------------------------------------

/**
 * TODO: Replace this stub with the actual localization / triangulation
 * algorithm. The function receives all controller positions plus their
 * SDR measurements and should return estimated transmitter locations.
 *
 * Current stub: returns a single location at the centroid of all
 * controller positions with a bounding box formed by the controller
 * positions themselves—useful for verifying the full pipeline end-to-end.
 */
async function computeLocations(
    payload: DispatchPayload
): Promise<WebhookLocation[]> {
    const { controllers, measurements: _measurements } = payload;

    // ---- Centroid of all controller positions (stub) ----
    const totalLat = controllers.reduce((sum, c) => sum + c.latitude, 0);
    const totalLng = controllers.reduce((sum, c) => sum + c.longitude, 0);
    const centerLatitude = totalLat / controllers.length;
    const centerLongitude = totalLng / controllers.length;

    const bounds = controllers.map((c) => ({
        latitude: c.latitude,
        longitude: c.longitude,
    }));

    // TODO: Implement real localization algorithm.
    //  - Parse `_measurements` (each contains `controllerId` + `samples[]`
    //    with `frequencyHz` / `powerDbm` pairs).
    //  - Use received signal strength (RSSI) or time-difference-of-arrival
    //    (TDOA) techniques to triangulate transmitter positions.
    //  - Return one `WebhookLocation` per detected transmitter.

    return [
        {
            centerLatitude,
            centerLongitude,
            bounds,
        },
    ];
}

// ---------------------------------------------------------------------------
// Crypto helpers (Node.js native — runs server-side in Next.js)
// ---------------------------------------------------------------------------

function hmacSign(secret: string, payload: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
