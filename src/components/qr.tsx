import { encode } from "uqr";

/** QR as inline SVG paths: no image request, nothing for the CSP to allow. */
export function Qr({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  const { data } = encode(text, { ecc: "M", border: 2 });
  let d = "";
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${data.length} ${data.length}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded bg-white"
    >
      <path d={d} fill="#000" />
    </svg>
  );
}
