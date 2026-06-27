import { query } from "../_generated/server";
import { requireAccess } from "../lib/utils";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../betterAuth/_generated/dataModel";

export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        controllerId: v.optional(v.id("controller")),
    },
    handler: async (ctx, { paginationOpts, controllerId }) => {
        const { user: admin } = await requireAccess(ctx, {
            sdr: ["list"],
        });

        const q = controllerId
            ? ctx.db
                .query("sdrMeasurement")
                .withIndex("by_controller_id", (q) =>
                    q.eq("controllerId", controllerId)
                )
                .filter((q) => q.eq(q.field("adminId"), admin._id))
            : ctx.db
                .query("sdrMeasurement")
                .withIndex("by_admin_id", (q) =>
                    q.eq("adminId", admin._id)
                );

        const result = await q.order("desc").paginate(paginationOpts);

        const controllerIds = Array.from(
            new Set(result.page.map((r) => r.controllerId))
        );
        const controllers = await Promise.all(
            controllerIds.map((id) => ctx.db.get(id))
        );
        const controllerNames = new Map<string, string>();
        for (const c of controllers) {
            if (!c) continue;
            const controllerUser: Doc<"user"> | null = await ctx.runQuery(
                components.betterAuth.adapter.findOne,
                {
                    model: "user",
                    where: [
                        {
                            field: "_id",
                            value: c.userId,
                            operator: "eq",
                        },
                    ],
                }
            );
            controllerNames.set(
                c._id,
                controllerUser?.name ?? c.serialNumber ?? "Unknown"
            );
        }

        return {
            ...result,
            page: result.page.map((row) => {
                let peakDbm: number | null = null;
                let minDbm: number | null = null;
                let minHz: number | null = null;
                let maxHz: number | null = null;
                for (const s of row.samples) {
                    if (peakDbm === null || s.powerDbm > peakDbm) peakDbm = s.powerDbm;
                    if (minDbm === null || s.powerDbm < minDbm) minDbm = s.powerDbm;
                    if (minHz === null || s.frequencyHz < minHz) minHz = s.frequencyHz;
                    if (maxHz === null || s.frequencyHz > maxHz) maxHz = s.frequencyHz;
                }
                return {
                    id: row._id,
                    createdAt: row._creationTime,
                    controllerId: row.controllerId,
                    controllerName:
                        controllerNames.get(row.controllerId) ?? "Unknown",
                    scanId: row.scanId,
                    sampleCount: row.samples.length,
                    peakDbm,
                    minDbm,
                    minFrequencyHz: minHz,
                    maxFrequencyHz: maxHz,
                    samples: row.samples,
                };
            }),
        };
    },
});

const MAX_EXPORT_MEASUREMENTS = 5000;
const MAX_EXPORT_SAMPLES = 500_000;

const csvEscape = (value: string | number): string => {
    const s = String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
};

export const exportCsv = query({
    args: {
        fromMs: v.optional(v.number()),
        toMs: v.optional(v.number()),
        controllerId: v.optional(v.id("controller")),
    },
    handler: async (ctx, { fromMs, toMs, controllerId }) => {
        const { user: admin } = await requireAccess(ctx, {
            sdr: ["list"],
        });

        const from = fromMs ?? 0;
        const to = toMs ?? Number.MAX_SAFE_INTEGER;
        if (from > to) {
            throw new ConvexError({
                code: "INVALID_INPUT",
                message: "fromMs must be <= toMs",
            });
        }

        let rowsQuery;
        if (controllerId) {
            rowsQuery = ctx.db
                .query("sdrMeasurement")
                .withIndex("by_controller_id", (q) =>
                    q.eq("controllerId", controllerId)
                )
                .filter((q) => q.eq(q.field("adminId"), admin._id));
        } else {
            rowsQuery = ctx.db
                .query("sdrMeasurement")
                .withIndex("by_admin_id", (q) => q.eq("adminId", admin._id));
        }

        const all = await rowsQuery.collect();
        const inRange = all.filter(
            (r) => r._creationTime >= from && r._creationTime <= to
        );

        let truncated = false;
        let rows = inRange.sort((a, b) => a._creationTime - b._creationTime);
        if (rows.length > MAX_EXPORT_MEASUREMENTS) {
            rows = rows.slice(0, MAX_EXPORT_MEASUREMENTS);
            truncated = true;
        }

        const controllerIds = Array.from(new Set(rows.map((r) => r.controllerId)));
        const controllers = await Promise.all(
            controllerIds.map((id) => ctx.db.get(id))
        );
        const nameById = new Map<string, string>();
        for (const c of controllers) {
            if (!c) continue;
            const u: Doc<"user"> | null = await ctx.runQuery(
                components.betterAuth.adapter.findOne,
                {
                    model: "user",
                    where: [
                        { field: "_id", value: c.userId, operator: "eq" },
                    ],
                }
            );
            nameById.set(c._id, u?.name ?? c.serialNumber ?? "Unknown");
        }

        const lines: string[] = [
            "timestampMs,timestampIso,controllerId,controllerName,scanId,measurementId,frequencyHz,powerDbm",
        ];
        let totalSamples = 0;
        for (const row of rows) {
            const iso = new Date(row._creationTime).toISOString();
            const name = nameById.get(row.controllerId) ?? "Unknown";
            for (const s of row.samples) {
                if (totalSamples >= MAX_EXPORT_SAMPLES) {
                    truncated = true;
                    break;
                }
                lines.push(
                    [
                        row._creationTime,
                        iso,
                        row.controllerId,
                        csvEscape(name),
                        csvEscape(row.scanId),
                        row._id,
                        s.frequencyHz,
                        s.powerDbm,
                    ].join(",")
                );
                totalSamples++;
            }
            if (totalSamples >= MAX_EXPORT_SAMPLES) break;
        }

        return {
            csv: lines.join("\n"),
            measurementCount: rows.length,
            sampleCount: totalSamples,
            truncated,
            fromMs: from === 0 ? null : from,
            toMs: to === Number.MAX_SAFE_INTEGER ? null : to,
        };
    },
});

export const listControllers = query({
    args: {},
    handler: async (ctx) => {
        const { user: admin } = await requireAccess(ctx, {
            sdr: ["list"],
        });

        const controllers = await ctx.db
            .query("controller")
            .withIndex("by_admin_id", (q) => q.eq("adminId", admin._id))
            .collect();

        const names = await Promise.all(
            controllers.map(async (c) => {
                const u: Doc<"user"> | null = await ctx.runQuery(
                    components.betterAuth.adapter.findOne,
                    {
                        model: "user",
                        where: [
                            {
                                field: "_id",
                                value: c.userId,
                                operator: "eq",
                            },
                        ],
                    }
                );
                return {
                    id: c._id,
                    name: u?.name ?? c.serialNumber ?? "Unknown",
                };
            })
        );

        return names;
    },
});
