import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
    runLocalization,
    LocalizationError,
    type LocalizationInput,
    type LocationResult,
} from "../lib/math/localize";

export const localize = internalAction({
    args: { batchId: v.id("jobBatch") },
    handler: async (ctx, { batchId }) => {
        const payload = await ctx.runQuery(
            internal.jobs.localization.getBatchPayload,
            { batchId }
        );

        if (!payload) {
            console.warn(`compute.localize: no payload for batch ${batchId}`);
            await ctx.runMutation(
                internal.jobs.localization.markBatchFailed,
                { batchId }
            );
            return;
        }

        const input: LocalizationInput = {
            batchId: payload.batchId,
            scanId: payload.scanId,
            controllers: payload.controllers,
            measurements: payload.measurements,
            localizationConfig: payload.localizationConfig,
        };

        const startedAt = Date.now();
        let locations: LocationResult[] = [];
        try {
            locations = runLocalization(input);
        } catch (e) {
            const msg =
                e instanceof LocalizationError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : String(e);
            console.error(
                `compute.localize batch=${payload.batchId} failed: ${msg}`
            );
        }

        const elapsed = Date.now() - startedAt;
        console.log(
            `compute.localize batch=${payload.batchId} locations=${locations.length} elapsedMs=${elapsed}`
        );

        await ctx.runMutation(
            internal.jobs.localization.storeLocationResults,
            {
                batchId: payload.batchId,
                scanId: payload.scanId,
                locations,
            }
        );
    },
});
