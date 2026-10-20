import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { api } from "../_generated/api";
import { raiseAlert } from "../alerts";
import { base64url } from "../lib/crypto";
import { advance, makeTest, setUp } from "./harness.setup";

const realFetch = globalThis.fetch;
let calls: { url: string; headers: Record<string, string>; bytes: number }[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      bytes: (init.body as Uint8Array).byteLength,
    });
    return new Response(null, { status: url.includes("gone") ? 410 : 201 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
  setSystemTime();
});

async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    p256dh: base64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

test("a critical alert pushes to every subscribed browser; 410s are dropped; warnings don't push", async () => {
  const t = makeTest();
  const op = await setUp(t);
  await op.mutation(api.push.subscribe, {
    endpoint: "https://push.example/ok",
    ...(await browserKeys()),
  });
  await op.mutation(api.push.subscribe, {
    endpoint: "https://push.example/gone",
    ...(await browserKeys()),
  });
  expect((await op.query(api.push.mySubscriptions, {})).length).toBe(2);

  await t.run((ctx) =>
    raiseAlert(
      ctx,
      {
        subjectKey: "ch:433925000",
        type: "new",
        kind: "event",
        severity: "warning",
        title: "New",
        detail: "",
      },
      Date.now(),
    ),
  );
  await advance(t, 0);
  expect(calls).toEqual([]);

  await t.run((ctx) =>
    raiseAlert(
      ctx,
      {
        subjectKey: "rx:abc",
        type: "offline",
        kind: "condition",
        severity: "critical",
        title: "A: no contact",
        detail: "12 min",
      },
      Date.now(),
    ),
  );
  await advance(t, 0);
  expect(calls.map((c) => c.url).sort()).toEqual([
    "https://push.example/gone",
    "https://push.example/ok",
  ]);
  expect(calls[0]?.headers).toMatchObject({
    "Content-Encoding": "aes128gcm",
    Urgency: "high",
    TTL: "86400",
  });
  expect(calls[0]?.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
  // 21-byte header + 65-byte key + ciphertext + 16-byte tag.
  expect(calls[0]?.bytes).toBeGreaterThan(21 + 65 + 16);
  expect((await op.query(api.push.mySubscriptions, {})).map((s) => s.endpoint)).toEqual([
    "https://push.example/ok",
  ]);

  await op.mutation(api.push.unsubscribe, { endpoint: "https://push.example/ok" });
  expect(await op.query(api.push.mySubscriptions, {})).toEqual([]);
});
