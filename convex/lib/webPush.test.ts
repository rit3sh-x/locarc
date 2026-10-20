import { expect, test } from "bun:test";
import { decodeJwt } from "jose";
import { base64url } from "./crypto";
import { encryptPayload, vapidAuthorization } from "./webPush";

// RFC 8291, Appendix A.
test("aes128gcm encryption reproduces the RFC 8291 test vector", async () => {
  const body = await encryptPayload(
    new TextEncoder().encode("When I grow up, I want to be a watermelon"),
    {
      p256dh:
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
    {
      sender: {
        publicKey:
          "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
        privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      },
      salt: "DGv6ra1nlYgDCS1FRnbzlw",
    },
  );
  expect(base64url(body)).toBe(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("VAPID claims: the push service origin, 12 h, the site as subject", async () => {
  const vapid = {
    publicKey:
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    subject: "https://locarc.example",
  };
  const header = await vapidAuthorization(
    "https://fcm.googleapis.com/fcm/send/abc",
    vapid,
    1_000_000_000_000,
  );
  const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
  expect(k).toBe(vapid.publicKey);
  expect(decodeJwt(t ?? "")).toMatchObject({
    aud: "https://fcm.googleapis.com",
    sub: "https://locarc.example",
    exp: 1_000_000_000 + 43_200,
  });
});
