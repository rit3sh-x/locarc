import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./betterAuth/auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { Webhook } from "svix";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

http.route({
    path: "/api/webhook/localization",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const webhookSecret = process.env.WEBHOOK_SECRET;
        if (!webhookSecret) {
            console.error("WEBHOOK_SECRET env var is not configured");
            return new Response(
                JSON.stringify({ error: "Server misconfiguration" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const rawBody = await request.text();

        const wh = new Webhook(webhookSecret);

        let body: unknown;
        try {
            body = wh.verify(rawBody, {
                "svix-id": request.headers.get("svix-id") ?? "",
                "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
                "svix-signature": request.headers.get("svix-signature") ?? "",
            });
        } catch {
            return new Response(
                JSON.stringify({ error: "Invalid webhook signature" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        const validationError = validateWebhookPayload(body);
        if (validationError) {
            return new Response(JSON.stringify({ error: validationError }), {
                status: 422,
                headers: { "Content-Type": "application/json" },
            });
        }

        const { batchId, scanId, locations } = body as WebhookPayload;

        try {
            await ctx.runMutation(
                internal.jobs.localization.processWebhookResults,
                {
                    batchId: batchId as Id<"jobBatch">,
                    scanId,
                    locations,
                }
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown error";
            console.error("Webhook processing failed:", message);
            return new Response(
                JSON.stringify({ error: "Processing failed", detail: message }),
                { status: 422, headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }),
});

export default http;

interface WebhookLocation {
    centerLongitude: number;
    centerLatitude: number;
    bounds: { longitude: number; latitude: number }[];
    frequencyHz?: number;
    controllerCount?: number;
}

interface WebhookPayload {
    batchId: string;
    scanId: string;
    locations: WebhookLocation[];
}

function validateWebhookPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
        return "Payload must be a JSON object";
    }

    const p = payload as Record<string, unknown>;

    if (typeof p.batchId !== "string" || p.batchId.length === 0) {
        return "Missing or invalid 'batchId'";
    }
    if (typeof p.scanId !== "string" || p.scanId.length === 0) {
        return "Missing or invalid 'scanId'";
    }
    if (!Array.isArray(p.locations)) {
        return "Missing or invalid 'locations' array";
    }

    for (let i = 0; i < p.locations.length; i++) {
        const loc = p.locations[i] as Record<string, unknown>;
        if (typeof loc.centerLongitude !== "number") {
            return `locations[${i}].centerLongitude must be a number`;
        }
        if (typeof loc.centerLatitude !== "number") {
            return `locations[${i}].centerLatitude must be a number`;
        }
        if (!Array.isArray(loc.bounds)) {
            return `locations[${i}].bounds must be an array`;
        }
        for (let j = 0; j < loc.bounds.length; j++) {
            const b = loc.bounds[j] as Record<string, unknown>;
            if (typeof b.longitude !== "number") {
                return `locations[${i}].bounds[${j}].longitude must be a number`;
            }
            if (typeof b.latitude !== "number") {
                return `locations[${i}].bounds[${j}].latitude must be a number`;
            }
        }
        if (loc.frequencyHz !== undefined && typeof loc.frequencyHz !== "number") {
            return `locations[${i}].frequencyHz must be a number`;
        }
        if (loc.controllerCount !== undefined && typeof loc.controllerCount !== "number") {
            return `locations[${i}].controllerCount must be a number`;
        }
    }

    return null;
}
