// Handle push events by displaying alert notifications. This service worker
// does not cache assets or provide offline support.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};

  event.waitUntil(
    self.registration.showNotification(data.title || "Locarc", {
      body: data.body || "",
      tag: data.tag,
      icon: "/favicon.svg",
      data: { url: data.url || "/" },
    }),
  );
});

// When a notification is clicked, focus an existing Locarc tab and navigate
// to the alert's page, or open a new tab if none exists.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const tab = tabs.find((client) => new URL(client.url).origin === self.location.origin);

      if (!tab) return self.clients.openWindow(url);

      await tab.focus();
      return tab.navigate(url);
    })(),
  );
});
