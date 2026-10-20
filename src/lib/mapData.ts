import type { Doc } from "@/convex/_generated/dataModel";
import { centroid, convexHull, type LatLng, localPlane } from "@/convex/lib/geo";
import type { MapReceiver } from "../components/map/map-canvas";
import type { FleetRow } from "./fleet";

/** Where to draw a Receiver: its pin when pinned, else its last GPS fix. */
export function receiverMarkers(fleet: FleetRow[]): MapReceiver[] {
  const out: MapReceiver[] = [];
  for (const { receiver, status, state } of fleet) {
    const pos = receiver.config.position;
    const at = pos.mode === "pinned" ? { lat: pos.lat, lng: pos.lng } : status?.position;
    if (at)
      out.push({
        id: receiver._id,
        name: receiver.name,
        state,
        pinned: pos.mode === "pinned",
        lat: at.lat,
        lng: at.lng,
      });
  }
  return out;
}

/** The dashed hull: where Fixes are trustworthy (around the Receivers that report). */
export function coverageHull(markers: MapReceiver[]): LatLng[] {
  const reporting = markers.filter((m) => m.state === "scanning");
  const pts = reporting.length >= 3 ? reporting : markers.filter((m) => m.state !== "offline");
  if (pts.length < 3) return [];
  const plane = localPlane(centroid(pts));
  return convexHull(pts.map(plane.toXY)).map(plane.toLatLng);
}

/** The newest stored Fix per Emitter, by frequency. */
export function latestPerEmitter(fixes: Doc<"fixes">[]): Doc<"fixes">[] {
  const byChannel = new Map<number, Doc<"fixes">>();
  for (const f of fixes) {
    const seen = byChannel.get(f.freqHz);
    if (!seen || f.at > seen.at) byChannel.set(f.freqHz, f);
  }
  return [...byChannel.values()].sort((a, b) => a.freqHz - b.freqHz);
}
