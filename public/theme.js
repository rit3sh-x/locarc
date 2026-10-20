// Runs before first paint so a remembered theme never flashes.
try {
  const t = localStorage.getItem("locarc-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {}
