import { formatMHz } from "@/convex/lib/channelMath";

// Categorical colours readable on the light basemap in both themes.
const PALETTE = [
  "#d9480f",
  "#6741d9",
  "#1971c2",
  "#c2255c",
  "#2b8a3e",
  "#e67700",
  "#0c8599",
  "#862e9c",
];

const slot = (freqHz: number) =>
  (Math.imul(Math.round(freqHz / 1000), 2654435761) >>> 0) % PALETTE.length;

/** A Channel's own colour when it's shown alone (Channel detail). */
export const channelColour = (freqHz: number) => PALETTE[slot(freqHz)] as string;

/**
 * Colours for the Channels shown together: each keeps its hashed colour unless a lower
 * frequency took it first, so up to 8 Channels on one screen never share a colour.
 */
export function channelColours(freqs: number[]): (freqHz: number) => string {
  const taken = new Set<number>();
  const colours = new Map<number, string>();
  for (const f of [...new Set(freqs)].sort((a, b) => a - b)) {
    let i = slot(f);
    for (let n = 0; n < PALETTE.length && taken.has(i); n++) i = (i + 1) % PALETTE.length;
    taken.add(i);
    colours.set(f, PALETTE[i] as string);
  }
  return (f) => colours.get(f) ?? channelColour(f);
}

export const mhz = formatMHz;
export const coords = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
export const metres = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
