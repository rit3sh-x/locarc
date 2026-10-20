import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "../components/ui/button";
import { toast } from "../components/ui/toast";
import { setTabNotifications, tabNotifications } from "../lib/notify";
import { currentSubscription, needsHomeScreen, pushSupported, subscribeBrowser } from "../lib/push";
import { Section } from "./settings";

export function NotificationsPage() {
  const [on, setOn] = useState(tabNotifications);
  const supported = typeof window !== "undefined" && "Notification" in window;
  const permission = supported ? Notification.permission : "denied";
  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Notifications</h1>
      <Section title="While Locarc is open">
        <p className="text-muted">
          A browser notification for every new alert, even when you're in another tab. Only one
          Locarc tab per browser notifies.
        </p>
        {!supported ? (
          <p>This browser doesn't support notifications.</p>
        ) : permission === "denied" ? (
          <p className="text-warn">
            Notifications are blocked for this site in the browser's settings.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <span role="status">{on ? "On in this browser" : "Off in this browser"}</span>
            <Button
              variant={on ? "secondary" : "primary"}
              onClick={async () => {
                if (on) {
                  setTabNotifications(false);
                  setOn(false);
                  return;
                }
                // Permission is asked only here, on an explicit click.
                if ((await Notification.requestPermission()) !== "granted") return;
                setTabNotifications(true);
                setOn(true);
              }}
            >
              {on ? "Turn off" : "Turn on"}
            </Button>
          </div>
        )}
      </Section>
      <PushSection />
    </div>
  );
}

function PushSection() {
  const publicKey = useQuery(api.push.publicKey);
  const mine = useQuery(api.push.mySubscriptions);
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (pushSupported()) void currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null));
  }, []);
  const on = !!endpoint && !!mine?.some((m) => m.endpoint === endpoint);
  const others = (mine?.length ?? 0) - (on ? 1 : 0);

  return (
    <Section title="Critical alerts when Locarc is closed">
      <p className="text-muted">
        Web Push for critical alerts only (a Receiver offline or needing attention), even with every
        Locarc tab closed.
      </p>
      {!pushSupported() ? (
        <p>This browser doesn't support Web Push.</p>
      ) : needsHomeScreen() ? (
        <p>
          On iPhone and iPad, push works only from the Home Screen: tap Share → Add to Home Screen,
          open Locarc from there, and turn it on here.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span role="status">{on ? "Push on for this browser" : "Push off for this browser"}</span>
          <Button
            variant={on ? "secondary" : "primary"}
            disabled={busy || endpoint === undefined || !publicKey}
            onClick={async () => {
              setBusy(true);
              try {
                if (on && endpoint) {
                  await (await currentSubscription())?.unsubscribe();
                  await unsubscribe({ endpoint });
                  setEndpoint(null);
                } else if (publicKey) {
                  if ((await Notification.requestPermission()) !== "granted") return;
                  const sub = await subscribeBrowser(publicKey);
                  await subscribe(sub);
                  setEndpoint(sub.endpoint);
                }
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {on ? "Turn off" : "Turn on"}
          </Button>
        </div>
      )}
      {others > 0 && (
        <p className="text-sm text-muted">
          Also on for {others} other browser{others === 1 ? "" : "s"} of yours.
        </p>
      )}
    </Section>
  );
}
