import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import type { HealthState } from "@/convex/lib/health";

setWorkerUrl(workerUrl);

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

const RING: Record<HealthState, string> = {
  scanning: "#1f8a4c",
  idle: "#8a94a1",
  awaiting_pairing: "#0b7a75",
  offline: "#8a94a1",
  needs_attention: "#c2362b",
  degraded: "#a86400",
  paused: "#8a94a1",
};

export type LatLng = { lat: number; lng: number };
export type MapReceiver = LatLng & {
  id: string;
  name: string;
  state: HealthState;
  pinned: boolean;
};
export type MapFix = LatLng & {
  freqHz: number;
  colour: string;
  region: LatLng[];
  dim?: boolean;
};

export type MapCanvasProps = {
  receivers: MapReceiver[];
  fixes: MapFix[];
  hull: LatLng[];
  trail?: LatLng[];
  dots?: (LatLng & { colour: string })[];
  onFix?: (freqHz: number) => void;
  onReceiver?: (id: string) => void;
  onMapClick?: (p: LatLng) => void;
  className?: string;
};

const ring = (points: LatLng[]) =>
  [...points, points[0]].filter(Boolean).map((p) => [p?.lng, p?.lat]);

function collections(p: MapCanvasProps) {
  return {
    regions: {
      type: "FeatureCollection" as const,
      features: p.fixes
        .filter((f) => f.region.length >= 3)
        .map((f) => ({
          type: "Feature" as const,
          properties: { colour: f.colour, dim: !!f.dim },
          geometry: { type: "Polygon" as const, coordinates: [ring(f.region)] },
        })),
    },
    fixes: {
      type: "FeatureCollection" as const,
      features: p.fixes.map((f) => ({
        type: "Feature" as const,
        properties: { colour: f.colour, freqHz: f.freqHz, dim: !!f.dim },
        geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
      })),
    },
    receivers: {
      type: "FeatureCollection" as const,
      features: p.receivers.map((r) => ({
        type: "Feature" as const,
        properties: {
          id: r.id,
          ring: RING[r.state],
          pinned: r.pinned,
          offline: r.state === "offline",
        },
        geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
      })),
    },
    hull: {
      type: "FeatureCollection" as const,
      features:
        p.hull.length >= 3
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: ring(p.hull) },
              },
            ]
          : [],
    },
    dots: {
      type: "FeatureCollection" as const,
      features: (p.dots ?? []).map((d) => ({
        type: "Feature" as const,
        properties: { colour: d.colour },
        geometry: { type: "Point" as const, coordinates: [d.lng, d.lat] },
      })),
    },
    trail: {
      type: "FeatureCollection" as const,
      features:
        (p.trail?.length ?? 0) >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: {
                  type: "LineString" as const,
                  coordinates: (p.trail ?? []).map((t) => [t.lng, t.lat]),
                },
              },
            ]
          : [],
    },
  };
}

export default function MapCanvas(props: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const m = new MapLibreMap({
      container: container.current,
      style: STYLE,
      center: [77.5946, 12.9716],
      zoom: 13,
      attributionControl: false,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const empty = { type: "FeatureCollection" as const, features: [] };
      for (const id of ["regions", "fixes", "receivers", "hull", "trail", "dots"])
        m.addSource(id, { type: "geojson", data: empty });
      m.addLayer({
        id: "regions-fill",
        type: "fill",
        source: "regions",
        paint: {
          "fill-color": ["get", "colour"],
          "fill-opacity": ["case", ["get", "dim"], 0.05, 0.14],
        },
      });
      m.addLayer({
        id: "regions-line",
        type: "line",
        source: "regions",
        paint: {
          "line-color": ["get", "colour"],
          "line-width": 1.5,
          "line-opacity": ["case", ["get", "dim"], 0.4, 1],
        },
      });
      m.addLayer({
        id: "hull",
        type: "line",
        source: "hull",
        paint: { "line-color": "#5a6573", "line-width": 1.5, "line-dasharray": [3, 3] },
      });
      m.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        paint: { "line-color": "#5a6573", "line-width": 1.5 },
      });
      m.addLayer({
        id: "fixes",
        type: "circle",
        source: "fixes",
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "colour"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
          "circle-opacity": ["case", ["get", "dim"], 0.45, 1],
        },
      });
      m.addLayer({
        id: "receivers",
        type: "circle",
        source: "receivers",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffffff",
          "circle-stroke-color": ["get", "ring"],
          "circle-stroke-width": ["case", ["get", "pinned"], 4, 2],
          "circle-opacity": ["case", ["get", "offline"], 0.5, 1],
          "circle-stroke-opacity": ["case", ["get", "offline"], 0.5, 1],
        },
      });
      m.on("click", "fixes", (e) => {
        const f = e.features?.[0]?.properties?.freqHz;
        if (typeof f === "number") handlers.current.onFix?.(f);
      });
      m.on("click", "receivers", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") handlers.current.onReceiver?.(id);
      });
      m.addLayer({
        id: "dots",
        type: "circle",
        source: "dots",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "colour"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });
      for (const layer of ["fixes", "receivers"]) {
        m.on("mouseenter", layer, () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
        });
      }
      setReady(true);
    });
    m.on("click", (e) => handlers.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const data = collections(props);
    for (const [id, fc] of Object.entries(data))
      (m.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    const points = [
      ...props.receivers,
      ...props.fixes,
      ...(props.trail ?? []),
      ...(props.dots ?? []),
    ];
    if (!fitted.current && points.length > 0) {
      fitted.current = true;
      const bounds = new LngLatBounds();

      for (const p of points) bounds.extend([p.lng, p.lat]);
      m.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
    }
  }, [ready, props]);

  return <div ref={container} className={props.className ?? "h-full w-full"} />;
}
