import { api } from "@/convex/_generated/api";
import { operatorClient } from "../fleet";
import { ensureSetUp, signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("push: Notifications subscribes this browser through the service worker, and unsubscribes", async ({
  page,
}) => {
  ensureSetUp();
  await page.context().grantPermissions(["notifications"]);
  // Headless Chrome refuses push registration ("permission denied") even with notifications
  // granted, so only the push service's half is faked; the service worker, page and backend are real.
  await page.addInitScript(() => {
    let current: PushSubscription | null = null;
    const b64url = (b: Uint8Array) =>
      btoa(String.fromCharCode(...b))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
    PushManager.prototype.subscribe = async () => {
      const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
        "deriveBits",
      ]);
      const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
      const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
      const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
      current = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      } as unknown as PushSubscription;
      return current;
    };
    PushManager.prototype.getSubscription = async () => current;
  });
  const noErrors = watchConsole(page);
  await signIn(page);
  await page.goto("/settings/notifications");
  const push = page.getByRole("region", { name: "Critical alerts when Locarc is closed" });
  await expect(push.getByRole("status")).toHaveText("Push off for this browser");
  await push.getByRole("button", { name: "Turn on" }).click();
  await expect(push.getByRole("status")).toHaveText("Push on for this browser");

  const op = await operatorClient();
  const [sub] = await op.query(api.push.mySubscriptions, {});
  expect(sub?.endpoint).toMatch(/^https:\/\//);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration("/"))?.active?.scriptURL,
    ),
  ).toMatch(/\/sw\.js$/);

  await push.getByRole("button", { name: "Turn off" }).click();
  await expect(push.getByRole("status")).toHaveText("Push off for this browser");
  expect(await op.query(api.push.mySubscriptions, {})).toEqual([]);
  noErrors();
});
