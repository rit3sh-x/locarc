import logging
import time
import numpy as np
import httpx
from svix.webhooks import Webhook

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models import (
    JobPayload, CallbackPayload, LocationResult, BoundPoint,
    LocalizationConfig as PayloadLocConfig,
)
from localization import LocalizationConfig, localize_annulus, localize_circle

log = logging.getLogger("compute")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

R = 6_371_000.0


def gps_to_xy(lat: float, lon: float, ref_lat: float, ref_lon: float):
    x = R * np.deg2rad(lon - ref_lon) * np.cos(np.deg2rad(ref_lat))
    y = R * np.deg2rad(lat - ref_lat)
    return float(x), float(y)


def xy_to_gps(x: float, y: float, ref_lat: float, ref_lon: float):
    lat = ref_lat + np.rad2deg(y / R)
    lon = ref_lon + np.rad2deg(x / (R * np.cos(np.deg2rad(ref_lat))))
    return float(lat), float(lon)

def bounds_to_corners(bounds, ref_lat: float, ref_lon: float) -> list[BoundPoint]:
    (x0, x1), (y0, y1) = bounds
    return [
        BoundPoint(latitude=lat, longitude=lon)
        for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        for lat, lon in [xy_to_gps(x, y, ref_lat, ref_lon)]
    ]

def _peak_power_dbm(samples: list) -> float:
    """Take the strongest (max) reading among samples at the same channel.

    Mobile may emit multiple phase3 integrations for the same channel within
    a single scan; the strongest represents the cleanest LOS observation.
    Mean-of-linear dilutes that with weaker frames and biases path-loss
    inversion toward longer distances.
    """
    return max(s.powerDbm for s in samples)


def _group_by_channel(
    payload: JobPayload, bin_hz: float
) -> dict[float, dict[str, float]]:
    """
    channel_hz -> { controllerId -> aggregated powerDbm }

    All samples are snapped onto the channel grid so the same transmitter
    observed by different receivers (with small frequency offsets) buckets
    to a single key. Per (channel, controller) we keep the peak reading.
    """
    by_ch: dict[float, dict[str, list]] = {}
    ctrl_ids = {c.controllerId for c in payload.controllers}

    for m in payload.measurements:
        if m.controllerId not in ctrl_ids:
            continue
        for s in m.samples:
            ch = round(s.frequencyHz / bin_hz) * bin_hz
            by_ch.setdefault(ch, {}).setdefault(m.controllerId, []).append(s)

    return {
        ch: {cid: _peak_power_dbm(lst) for cid, lst in ctrl_map.items()}
        for ch, ctrl_map in by_ch.items()
    }


def run_localization(payload: JobPayload) -> list[LocationResult]:
    if len(payload.controllers) < 3:
        raise ValueError("Need ≥3 receivers for localization")

    ctrl_map = {c.controllerId: c for c in payload.controllers}
    loc_cfg = payload.localizationConfig or PayloadLocConfig()

    cfg = LocalizationConfig(
        path_loss_exponent=loc_cfg.pathLossExponent,
        pt_min_dbm=loc_cfg.ptSearchRangeMinDbm,
        pt_max_dbm=loc_cfg.ptSearchRangeMaxDbm,
        pt_step_dbm=loc_cfg.ptSearchStepDbm,
    )
    algo = loc_cfg.algorithm

    by_channel = _group_by_channel(payload, loc_cfg.channelBinHz)
    log.info(
        "batch=%s channels=%d controllers=%d",
        payload.batchId, len(by_channel), len(ctrl_map),
    )

    results: list[LocationResult] = []

    for channel_hz in sorted(by_channel):
        power_by_ctrl = by_channel[channel_hz]
        if len(power_by_ctrl) < loc_cfg.minControllersPerChannel:
            continue
        if max(power_by_ctrl.values()) < loc_cfg.minPeakDbm:
            continue

        ctrl_ids = list(power_by_ctrl.keys())
        lats = [ctrl_map[cid].latitude for cid in ctrl_ids]
        lons = [ctrl_map[cid].longitude for cid in ctrl_ids]
        ref_lat, ref_lon = float(np.mean(lats)), float(np.mean(lons))

        receivers_xy = np.array([
            gps_to_xy(ctrl_map[cid].latitude, ctrl_map[cid].longitude,
                      ref_lat, ref_lon)
            for cid in ctrl_ids
        ])
        powers = np.array([power_by_ctrl[cid] for cid in ctrl_ids])

        try:
            if algo == "annulus":
                est_xy, bounds = localize_annulus(receivers_xy, powers, cfg)
            else:
                est_xy, bounds = localize_circle(receivers_xy, powers, cfg)
        except Exception as exc:
            log.warning(
                "channel=%.3f MHz localize failed: %s",
                channel_hz / 1e6, exc,
            )
            continue

        center_lat, center_lon = xy_to_gps(est_xy[0], est_xy[1], ref_lat, ref_lon)
        bound_pts = bounds_to_corners(bounds, ref_lat, ref_lon)

        log.info(
            "batch=%s ch=%.4f MHz rx=%d → (%.6f, %.6f)",
            payload.batchId, channel_hz / 1e6, len(ctrl_ids),
            center_lat, center_lon,
        )

        results.append(LocationResult(
            centerLatitude=center_lat,
            centerLongitude=center_lon,
            bounds=bound_pts,
            frequencyHz=channel_hz,
            controllerCount=len(ctrl_ids),
        ))

    if not results:
        raise ValueError(
            f"No channel observed by ≥{loc_cfg.minControllersPerChannel} controllers "
            f"with peak ≥{loc_cfg.minPeakDbm} dBm"
        )
    return results

async def post_callback(url: str, body: CallbackPayload) -> None:
    raw_body = body.model_dump_json()

    wh = Webhook(settings.webhook_secret)
    msg_id = f"msg_{body.batchId}"
    timestamp = int(time.time())
    signature = wh.sign(msg_id, timestamp, raw_body)

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(
                url,
                content=raw_body,
                headers={
                    "Content-Type": "application/json",
                    "svix-id": msg_id,
                    "svix-timestamp": str(timestamp),
                    "svix-signature": signature,
                },
            )
            r.raise_for_status()
            log.info("Callback OK → %s  HTTP %d", url, r.status_code)
        except Exception as exc:
            log.error("Callback FAILED → %s  %s", url, exc)


@asynccontextmanager
async def lifespan(_app):
    log.info("Compute service ready")
    yield

app = FastAPI(title="RF Localization Compute Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.convex_site_url],
    allow_methods=["POST"],
    allow_headers=["Content-Type", "svix-id", "svix-timestamp", "svix-signature"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/compute", status_code=202)
async def compute(request: Request, background: BackgroundTasks):
    raw = await request.body()

    wh = Webhook(settings.webhook_secret)
    try:
        wh.verify(raw, {
            "svix-id": request.headers.get("svix-id", ""),
            "svix-timestamp": request.headers.get("svix-timestamp", ""),
            "svix-signature": request.headers.get("svix-signature", ""),
        })
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = JobPayload.model_validate_json(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not payload.callbackUrl.startswith(settings.convex_site_url):
        raise HTTPException(
            status_code=403,
            detail="Callback URL must point to the configured Convex site",
        )

    log.info("Accepted batch=%s scan=%s", payload.batchId, payload.scanId)

    async def _work():
        try:
            locations = run_localization(payload)
        except Exception as exc:
            log.error("Localization error batch=%s: %s", payload.batchId, exc)
            locations = []

        await post_callback(
            payload.callbackUrl,
            CallbackPayload(
                batchId=payload.batchId,
                scanId=payload.scanId,
                locations=locations,
            ),
        )

    background.add_task(_work)
    return {"accepted": True, "batchId": payload.batchId}
