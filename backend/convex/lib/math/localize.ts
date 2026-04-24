import {
    boundsToCorners,
    gpsToXy,
    mean,
    xyToGps,
    type Vec2,
} from "./index";
import {
    DEFAULT_LOC_CONFIG,
    localizeAnnulus,
    type LocalizationConfig,
} from "./annulus";
import { localizeCircle } from "./circle";

export type LocalizationAlgorithm = "annulus" | "fourCircle";

export interface LocalizationPayloadConfig {
    algorithm: LocalizationAlgorithm;
    pathLossExponent: number;
    ptSearchRangeMinDbm: number;
    ptSearchRangeMaxDbm: number;
    ptSearchStepDbm: number;
    powerErrorRangeDb: number;
    channelToleranceHz?: number;
    channelMaxSpanHz?: number;
    minControllersPerChannel?: number;
    minPeakDbm?: number;
}

export interface LocalizationInputController {
    controllerId: string;
    latitude: number;
    longitude: number;
}

export interface LocalizationInputSample {
    frequencyHz: number;
    powerDbm: number;
}

export interface LocalizationInputMeasurement {
    controllerId: string;
    samples: LocalizationInputSample[];
}

export interface LocalizationInput {
    batchId: string;
    scanId: string;
    controllers: LocalizationInputController[];
    measurements: LocalizationInputMeasurement[];
    localizationConfig: LocalizationPayloadConfig | null;
}

export interface LocationResult {
    centerLatitude: number;
    centerLongitude: number;
    bounds: { latitude: number; longitude: number }[];
    frequencyHz?: number;
    controllerCount?: number;
}

const DEFAULT_CHANNEL_TOLERANCE_HZ = 150_000;
const DEFAULT_CHANNEL_MAX_SPAN_HZ = 400_000;
const DEFAULT_MIN_CONTROLLERS = 3;
const DEFAULT_MIN_PEAK_DBM = -110;

function groupByChannel(
    payload: LocalizationInput,
    toleranceHz: number,
    maxSpanHz: number
): Map<number, Map<string, number>> {
    const ctrlIds = new Set(payload.controllers.map((c) => c.controllerId));
    type Obs = { controllerId: string; freq: number; power: number };
    const obs: Obs[] = [];
    for (const m of payload.measurements) {
        if (!ctrlIds.has(m.controllerId)) continue;
        for (const s of m.samples) {
            obs.push({
                controllerId: m.controllerId,
                freq: s.frequencyHz,
                power: s.powerDbm,
            });
        }
    }
    if (obs.length === 0) return new Map();
    obs.sort((a, b) => a.freq - b.freq);

    const clusters: Obs[][] = [];
    let current: Obs[] = [obs[0]];
    for (let i = 1; i < obs.length; i++) {
        const gap = obs[i].freq - obs[i - 1].freq;
        if (gap <= toleranceHz) current.push(obs[i]);
        else {
            clusters.push(current);
            current = [obs[i]];
        }
    }
    clusters.push(current);

    const out = new Map<number, Map<string, number>>();
    for (const cluster of clusters) {
        const span = cluster[cluster.length - 1].freq - cluster[0].freq;
        if (span > maxSpanHz) continue;
        const centerHz =
            cluster.reduce((s, o) => s + o.freq, 0) / cluster.length;
        const byCtrl = new Map<string, number>();
        for (const o of cluster) {
            const prev = byCtrl.get(o.controllerId) ?? -Infinity;
            if (o.power > prev) byCtrl.set(o.controllerId, o.power);
        }
        out.set(centerHz, byCtrl);
    }
    return out;
}

export class LocalizationError extends Error { }

export function runLocalization(
    payload: LocalizationInput
): LocationResult[] {
    if (payload.controllers.length < 3) {
        throw new LocalizationError("Need ≥3 receivers for localization");
    }

    const locCfg = payload.localizationConfig;
    const cfg: LocalizationConfig = {
        ...DEFAULT_LOC_CONFIG,
        pathLossExponent: locCfg?.pathLossExponent ?? DEFAULT_LOC_CONFIG.pathLossExponent,
        ptMinDbm: locCfg?.ptSearchRangeMinDbm ?? DEFAULT_LOC_CONFIG.ptMinDbm,
        ptMaxDbm: locCfg?.ptSearchRangeMaxDbm ?? DEFAULT_LOC_CONFIG.ptMaxDbm,
        ptStepDbm: locCfg?.ptSearchStepDbm ?? DEFAULT_LOC_CONFIG.ptStepDbm,
    };
    const algo: LocalizationAlgorithm = locCfg?.algorithm ?? "annulus";
    const toleranceHz =
        locCfg?.channelToleranceHz ?? DEFAULT_CHANNEL_TOLERANCE_HZ;
    const maxSpanHz = locCfg?.channelMaxSpanHz ?? DEFAULT_CHANNEL_MAX_SPAN_HZ;
    const minControllers =
        locCfg?.minControllersPerChannel ?? DEFAULT_MIN_CONTROLLERS;
    const minPeakDbm = locCfg?.minPeakDbm ?? DEFAULT_MIN_PEAK_DBM;

    const ctrlMap = new Map(
        payload.controllers.map((c) => [c.controllerId, c])
    );
    const byChannel = groupByChannel(payload, toleranceHz, maxSpanHz);

    console.log(
        `localize batch=${payload.batchId} channels=${byChannel.size} controllers=${ctrlMap.size}`
    );

    const results: LocationResult[] = [];
    const channelsSorted = Array.from(byChannel.keys()).sort((a, b) => a - b);

    for (const channelHz of channelsSorted) {
        const powerByCtrl = byChannel.get(channelHz)!;
        if (powerByCtrl.size < minControllers) continue;
        let maxPower = -Infinity;
        for (const p of powerByCtrl.values()) if (p > maxPower) maxPower = p;
        if (maxPower < minPeakDbm) continue;

        const ctrlIds = Array.from(powerByCtrl.keys());
        const lats = ctrlIds.map((cid) => ctrlMap.get(cid)!.latitude);
        const lons = ctrlIds.map((cid) => ctrlMap.get(cid)!.longitude);
        const refLat = mean(lats);
        const refLon = mean(lons);

        const receivers: Vec2[] = ctrlIds.map((cid) => {
            const c = ctrlMap.get(cid)!;
            return gpsToXy(c.latitude, c.longitude, refLat, refLon);
        });
        const powers = ctrlIds.map((cid) => powerByCtrl.get(cid)!);

        try {
            const { est, bounds } =
                algo === "annulus"
                    ? localizeAnnulus(receivers, powers, cfg)
                    : localizeCircle(receivers, powers, cfg);

            const { latitude: centerLat, longitude: centerLon } = xyToGps(
                est[0],
                est[1],
                refLat,
                refLon
            );
            const corners = boundsToCorners(bounds, refLat, refLon);

            console.log(
                `localize batch=${payload.batchId} ch=${(channelHz / 1e6).toFixed(4)} MHz rx=${ctrlIds.length} → (${centerLat.toFixed(6)}, ${centerLon.toFixed(6)})`
            );

            results.push({
                centerLatitude: centerLat,
                centerLongitude: centerLon,
                bounds: corners,
                frequencyHz: channelHz,
                controllerCount: ctrlIds.length,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(
                `localize batch=${payload.batchId} ch=${(channelHz / 1e6).toFixed(4)} MHz failed: ${msg}`
            );
        }
    }

    if (results.length === 0) {
        throw new LocalizationError(
            `No channel observed by ≥${minControllers} controllers with peak ≥${minPeakDbm} dBm`
        );
    }
    return results;
}
