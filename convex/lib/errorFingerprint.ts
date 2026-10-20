// Errors from the website, the server and Receivers, grouped by fingerprint and redacted.
// The same module runs in the browser (before sending) and on the server (again, on receipt).

export type ErrorSource = "web" | "server" | "android";
export const MAX_STACK_BYTES = 4096;

/** Masks what must never be stored: emails, secrets, tokens and URL query strings. */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(
      /((?:password|passwd|secret|token|key|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
      "$1<redacted>",
    )
    .replace(/\bBearer\s+[\w.~+/=-]+/g, "Bearer <redacted>")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>")
    .replace(/(https?:\/\/[^\s?#"']+)\?[^\s#"']*/g, "$1?<query>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<token>");
}

/** Numbers and ids differ between occurrences of one bug; they're dropped from the grouping. */
export const normalizeMessage = (message: string) =>
  redact(message)
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

/** The first stack frame that names a location, without line and column numbers. */
export function topFrame(stack: string | null | undefined): string {
  const line = (stack ?? "")
    .split("\n")
    .find((l) => /\bat\b|@|\(.+:\d+/.test(l) && !/^\s*\w*Error\b/.test(l));
  return (line ?? "")
    .trim()
    .replace(/:\d+(:\d+)?\)?$/, "")
    .replace(/\?[^)\s]*/g, "")
    .replace(/^at\s+/, "")
    .slice(0, 200);
}

/** cyrb53: a fast, stable 53-bit string hash (grouping only, not security). */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function fingerprint(e: {
  source: ErrorSource;
  kind: string;
  message: string;
  stack?: string | null;
}): string {
  return hash([e.source, e.kind, normalizeMessage(e.message), topFrame(e.stack)].join("|"));
}

/** A redacted sample stack of at most 4 KB. */
export const sampleStack = (stack: string | null | undefined) => {
  const text = redact(stack ?? "");
  return text.length > MAX_STACK_BYTES ? `${text.slice(0, MAX_STACK_BYTES - 1)}…` : text;
};
