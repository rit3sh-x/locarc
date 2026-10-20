// Web Push without a library: VAPID (RFC 8292) with jose, and aes128gcm payload encryption
// (RFC 8291) with WebCrypto. Works in Convex's default runtime.
import { importJWK, SignJWT } from "jose";
import { base64url, base64urlDecode } from "./crypto";

const enc = new TextEncoder();
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/** HKDF-Expand for one block (every length here is ≤ 32). */
const expand = async (prk: Uint8Array, info: Uint8Array, length: number) =>
  (await hmac(prk, concat(info, Uint8Array.of(1)))).slice(0, length);

/** A P-256 key as JWK from its raw public point (65 bytes) and, optionally, private scalar. */
function p256Jwk(publicRaw: Uint8Array, d?: string): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: base64url(publicRaw.slice(1, 33)),
    y: base64url(publicRaw.slice(33, 65)),
    ...(d ? { d } : {}),
  };
}

export type PushSubscriptionKeys = { p256dh: string; auth: string };

/**
 * RFC 8291 aes128gcm: one record, the whole message. `sender` and `salt` exist for the RFC's
 * test vector; real sends get a fresh key pair and salt each time.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  keys: PushSubscriptionKeys,
  test?: { sender: { publicKey: string; privateKey: string }; salt: string },
): Promise<Uint8Array> {
  const uaPublic = base64urlDecode(keys.p256dh);
  const auth = base64urlDecode(keys.auth);
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (test) {
    asPublic = base64urlDecode(test.sender.publicKey);
    asPrivate = await crypto.subtle.importKey(
      "jwk",
      p256Jwk(asPublic, test.sender.privateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256),
  );

  const prkKey = await hmac(auth, ecdh);
  const ikm = await expand(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = test ? base64urlDecode(test.salt) : crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = await expand(prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await expand(prk, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  const record = concat(plaintext, Uint8Array.of(2));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      record as BufferSource,
    ),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/** The VAPID Authorization header for one push service origin (valid 12 h). */
export async function vapidAuthorization(
  endpoint: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
  now = Date.now(),
): Promise<string> {
  const key = await importJWK(p256Jwk(base64urlDecode(vapid.publicKey), vapid.privateKey), "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime(Math.floor(now / 1000) + 12 * 3600)
    .setSubject(vapid.subject)
    .sign(key);
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}
