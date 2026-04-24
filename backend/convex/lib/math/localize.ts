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
    channelBinHz?: number;
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

const DEFAULT_CHANNEL_BIN_HZ = 12_500;
const DEFAULT_MIN_CONTROLLERS = 3;
const DEFAULT_MIN_PEAK_DBM = -110;

function peakPowerDbm(samples: LocalizationInputSample[]): number {
    let best = -Infinity;
    for (const s of samples) if (s.powerDbm > best) best = s.powerDbm;
    return best;
}

function groupByChannel(
    payload: LocalizationInput,
    binHz: number
): Map<number, Map<string, number>> {
    const ctrlIds = new Set(payload.controllers.map((c) => c.controllerId));
    const buckets = new Map<number, Map<string, LocalizationInputSample[]>>();

    for (const m of payload.measurements) {
        if (!ctrlIds.has(m.controllerId)) continue;
        for (const s of m.samples) {
            const ch = Math.round(s.frequencyHz / binHz) * binHz;
            let row = buckets.get(ch);
            if (!row) {
                row = new Map();
                buckets.set(ch, row);
            }
            let arr = row.get(m.controllerId);
            if (!arr) {
                arr = [];
                row.set(m.controllerId, arr);
            }
            arr.push(s);
        }
    }

    const out = new Map<number, Map<string, number>>();
    for (const [ch, row] of buckets) {
        const red = new Map<string, number>();
        for (const [cid, list] of row) red.set(cid, peakPowerDbm(list));
        out.set(ch, red);
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
    const binHz = locCfg?.channelBinHz ?? DEFAULT_CHANNEL_BIN_HZ;
    const minControllers =
        locCfg?.minControllersPerChannel ?? DEFAULT_MIN_CONTROLLERS;
    const minPeakDbm = locCfg?.minPeakDbm ?? DEFAULT_MIN_PEAK_DBM;

    const ctrlMap = new Map(
        payload.controllers.map((c) => [c.controllerId, c])
    );
    const byChannel = groupByChannel(payload, binHz);

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
