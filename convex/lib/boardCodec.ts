// Compact representation of the Emitter board for one Scan. Includes all
// detected Emitters and previously located Emitters missed for up to two Scans.
// Encoded in little-endian format (version 1) because the website and phones
// consume the board on every Scan. The Kotlin decoder must match
// `wire/board.golden.json`.
//
// Header:
//   u8  version (1)
//   u16 itemCount
//
// Items are sorted by ascending name Channel. Each item is 50 bytes:
//
//   u32 name Channel
//   u32 first Channel
//   u16 width in Channels
//   u8  Receivers that heard the Emitter
//   u8  Receivers used for the Fix
//   u8  index of the loudest Receiver
//   u8  flags:
//         bit 0: located this Scan
//         bit 1: unconfirmed
//         bit 2: poor fit
//         bit 3: collinear
//         bit 4: Receiver moved
//         bit 5: clipped
//         bit 6: Fix stored this Scan
//   u8  Scans missed since last localization (0–2; 255 = never located)
//   i16 Fix-window power (0.1 dBm; -32768 = unavailable)
//   i16 peak power (0.1 dBm)
//   u16 Occupancy (0.01 percentage points)
//
// Latest position:
//   i32 latitude (10⁻⁶ degrees)
//   i32 longitude (10⁻⁶ degrees)
//   u16 uncertainty radius (m)
//   i16 Pt (0.1 dBm)
//
// Last stored Fix:
//   i32 latitude (10⁻⁶ degrees)
//   i32 longitude (10⁻⁶ degrees)
//   u16 uncertainty radius (m)
//   i16 Pt (0.1 dBm)
//   u8  Occupancy class
//   u32 storage timestamp (Unix seconds; 0 = none)

export const BOARD_VERSION = 1;
export const BOARD_ITEM_BYTES = 50;
const NONE = -0x8000;
const NEVER = 255;

export type OccupancyClass = 0 | 1 | 2;

export type Place = {
  lat: number;
  lng: number;
  radiusM: number;
  ptDbm: number;
};

export type BoardItem = {
  ch: number;
  firstCh: number;
  widthCh: number;
  heard: number;
  used: number;
  loudest: number;
  located: boolean;
  unconfirmed: boolean;
  poorFit: boolean;
  collinear: boolean;
  receiverMoved: boolean;
  clipped: boolean;
  fixStored: boolean;
  /** Scans since it was last located: 0–2, or null when never located. */
  missed: number | null;
  powerDbm: number | null;
  peakDbm: number;
  /** Share of the window's passes it was on, 0–1. */
  occupancy: number;
  /** Where it was last located (null when never). */
  position: Place | null;
  /** Its last stored Fix, which the next Scan's change test compares against. */
  lastStored: (Place & { occupancyClass: OccupancyClass; at: number }) | null;
};

const FLAGS = [
  "located",
  "unconfirmed",
  "poorFit",
  "collinear",
  "receiverMoved",
  "clipped",
  "fixStored",
] as const;

const tenths = (x: number) => Math.min(0x7fff, Math.max(-0x7fff, Math.round(x * 10)));
const micro = (deg: number) => Math.round(deg * 1e6);
const clamp16 = (x: number) => Math.min(0xffff, Math.max(0, Math.round(x)));

export function encodeBoard(items: BoardItem[]): Uint8Array<ArrayBuffer> {
  if (items.length > 0xffff) throw new Error("too many board items");
  const view = new DataView(new ArrayBuffer(3 + BOARD_ITEM_BYTES * items.length));
  view.setUint8(0, BOARD_VERSION);
  view.setUint16(1, items.length, true);
  let o = 3;
  for (const it of [...items].sort((a, b) => a.ch - b.ch)) {
    view.setUint32(o, it.ch, true);
    view.setUint32(o + 4, it.firstCh, true);
    view.setUint16(o + 8, clamp16(it.widthCh), true);
    view.setUint8(o + 10, Math.min(255, it.heard));
    view.setUint8(o + 11, Math.min(255, it.used));
    view.setUint8(o + 12, Math.min(255, it.loudest));
    view.setUint8(
      o + 13,
      FLAGS.reduce((f, k, bit) => f | (it[k] ? 1 << bit : 0), 0),
    );
    view.setUint8(o + 14, it.missed === null ? NEVER : Math.min(254, it.missed));
    view.setInt16(o + 15, it.powerDbm === null ? NONE : tenths(it.powerDbm), true);
    view.setInt16(o + 17, tenths(it.peakDbm), true);
    view.setUint16(o + 19, clamp16(it.occupancy * 10_000), true);
    const p = it.position;
    view.setInt32(o + 21, p ? micro(p.lat) : 0, true);
    view.setInt32(o + 25, p ? micro(p.lng) : 0, true);
    view.setUint16(o + 29, p ? clamp16(p.radiusM) : 0, true);
    view.setInt16(o + 31, p ? tenths(p.ptDbm) : 0, true);
    const s = it.lastStored;
    view.setInt32(o + 33, s ? micro(s.lat) : 0, true);
    view.setInt32(o + 37, s ? micro(s.lng) : 0, true);
    view.setUint16(o + 41, s ? clamp16(s.radiusM) : 0, true);
    view.setInt16(o + 43, s ? tenths(s.ptDbm) : 0, true);
    view.setUint8(o + 45, s ? s.occupancyClass : 0);
    view.setUint32(o + 46, s ? Math.round(s.at / 1000) : 0, true);
    o += BOARD_ITEM_BYTES;
  }
  return new Uint8Array(view.buffer);
}

export function decodeBoard(payload: ArrayBuffer | Uint8Array): BoardItem[] {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== BOARD_VERSION) throw new Error(`unsupported board version ${version}`);
  const count = view.getUint16(1, true);
  if (bytes.byteLength !== 3 + count * BOARD_ITEM_BYTES) throw new Error("board has bad length");
  const items: BoardItem[] = [];
  for (let i = 0, o = 3; i < count; i++, o += BOARD_ITEM_BYTES) {
    const flags = view.getUint8(o + 13);
    const missed = view.getUint8(o + 14);
    const power = view.getInt16(o + 15, true);
    const at = view.getUint32(o + 46, true);
    const flag = Object.fromEntries(FLAGS.map((k, bit) => [k, (flags & (1 << bit)) !== 0])) as {
      [K in (typeof FLAGS)[number]]: boolean;
    };
    items.push({
      ch: view.getUint32(o, true),
      firstCh: view.getUint32(o + 4, true),
      widthCh: view.getUint16(o + 8, true),
      heard: view.getUint8(o + 10),
      used: view.getUint8(o + 11),
      loudest: view.getUint8(o + 12),
      ...flag,
      missed: missed === NEVER ? null : missed,
      powerDbm: power === NONE ? null : power / 10,
      peakDbm: view.getInt16(o + 17, true) / 10,
      occupancy: view.getUint16(o + 19, true) / 10_000,
      position:
        missed === NEVER
          ? null
          : {
              lat: view.getInt32(o + 21, true) / 1e6,
              lng: view.getInt32(o + 25, true) / 1e6,
              radiusM: view.getUint16(o + 29, true),
              ptDbm: view.getInt16(o + 31, true) / 10,
            },
      lastStored:
        at === 0
          ? null
          : {
              lat: view.getInt32(o + 33, true) / 1e6,
              lng: view.getInt32(o + 37, true) / 1e6,
              radiusM: view.getUint16(o + 41, true),
              ptDbm: view.getInt16(o + 43, true) / 10,
              occupancyClass: view.getUint8(o + 45) as OccupancyClass,
              at: at * 1000,
            },
    });
  }
  return items;
}
