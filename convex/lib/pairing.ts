// 8-character Crockford base32 pairing codes (40 bits), shown as XXXX-XXXX.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const PAIRING_TTL_MS = 10 * 60_000;

export function newPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

/** Accepts what a person types: any case, dashes or spaces, and the I/L/O look-alikes. */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}

export const formatPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What the pairing QR encodes: the deployment the phone should talk to, and the code. */
export const pairingUri = (deploymentUrl: string, code: string) =>
  `locarc://pair?deployment=${encodeURIComponent(deploymentUrl)}&code=${code}`;
