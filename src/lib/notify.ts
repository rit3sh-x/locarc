import { useRouter } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";

const KEY = "locarc-tab-notify";

export function tabNotifications(): boolean {
  try {
    return (
      localStorage.getItem(KEY) === "on" &&
      "Notification" in window &&
      Notification.permission === "granted"
    );
  } catch {
    return false;
  }
}

export function setTabNotifications(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {}
}

// One tab per browser notifies: whichever holds this lock, for as long as it stays open.
let leader: boolean = typeof navigator !== "undefined" && !navigator.locks;
if (typeof navigator !== "undefined" && navigator.locks) {
  void navigator.locks.request("locarc-notify-leader", () => {
    leader = true;
    return new Promise(() => {});
  });
}

/** Browser notifications for alerts that open while a Locarc tab is open (never on page load). */
export function useOpenTabNotifications() {
  const alerts = useQuery(api.alerts.open);
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!alerts) return;
    const ids = alerts.open.map((a) => a._id as string);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const fresh = alerts.open.filter((a) => !known.has(a._id));
    for (const id of ids) known.add(id);
    if (fresh.length === 0 || !leader || !tabNotifications()) return;
    for (const a of fresh) {
      const n = new Notification(a.title, { body: a.detail, tag: a._id });
      n.onclick = () => {
        window.focus();
        const [kind, id = ""] = a.subjectKey.split(":");
        if (kind === "rx")
          void router.navigate({ to: "/receivers/$receiverId", params: { receiverId: id } });
        else if (kind === "ch")
          void router.navigate({ to: "/emitters/$freqHz", params: { freqHz: id } });
        else void router.navigate({ to: "/settings/diagnostics" });
      };
    }
  }, [alerts, router]);
}
