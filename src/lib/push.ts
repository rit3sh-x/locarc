/** This browser's Web Push subscription, through the push-only service worker. */
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window;

/** iPhone and iPad only deliver Web Push to a Home Screen web app. */
export const needsHomeScreen = () =>
  /iPhone|iPad/.test(navigator.userAgent) && !matchMedia("(display-mode: standalone)").matches;

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function subscribeBrowser(publicKey: string) {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(publicKey.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const { keys } = sub.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error("The push subscription has no keys");
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}
