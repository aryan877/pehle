// Pehle's service worker: shows the browser alerts the server sends and opens the right page on tap.
// The payload is JSON: { "title": "...", "body": "...", "url": "/o/<id>", "tag": "order-<id>" }.
// It deliberately caches nothing, so a deploy is never hidden behind a stale copy.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Pehle";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url: data.url || "/" },
  };
  if (data.tag) {
    options.tag = data.tag;
    // A newer alert with the same tag (the same order, say) replaces the old one and still buzzes.
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  // Only open pages on this site.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((c) => c.url === url);
      if (exact) return exact.focus();
      const ours = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (ours && "navigate" in ours) {
        try {
          const navigated = await ours.navigate(url);
          if (navigated) return navigated.focus();
        } catch {
          // Not controlled by this worker yet: fall through to a new window.
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
