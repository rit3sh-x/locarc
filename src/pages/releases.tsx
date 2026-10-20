import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "../components/ui/button";
import { toast } from "../components/ui/toast";
import { rolloutState, useFleet } from "../lib/fleet";
import { dateTime, useNow } from "../lib/time";
import { Section } from "./settings";

const CHECKLIST = [
  ["pair", "Paired a real phone + HackRF by QR"],
  ["three-scans", "Ran 3 Scans that produced Readings"],
  ["replug", "Unplugged and replugged the HackRF: scanning resumed by itself"],
  ["airplane-drain", "Airplane mode on, then off: the outbox drained"],
  ["kill-exit-reason", "Killed the app: its exit reason reached Diagnostics"],
] as const;

type Release = Doc<"releases"> & { url: string | null };
const kb = (bytes: number) =>
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;

export function ReleasesPage() {
  const releases = useQuery(api.releases.list);
  const fleet = useFleet(useNow(30_000));
  if (!releases || !fleet) return null;
  const [current, previous] = releases.promoted;
  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Releases</h1>
      {releases.candidate ? (
        <Candidate release={releases.candidate} />
      ) : (
        <Section title="Candidate">
          <p className="text-muted">
            No candidate. The Android workflow publishes one when Android code changes on main.
          </p>
        </Section>
      )}
      <Section title="Promoted">
        {current ? (
          <div className="grid gap-3">
            <ReleaseFacts release={current} label="Current" />
            {previous && <ReleaseFacts release={previous} label="Previous" />}
          </div>
        ) : (
          <p className="text-muted">Nothing promoted yet.</p>
        )}
      </Section>
      <Section title="Rollout">
        <ul className="-mx-3 divide-y divide-line" data-testid="rollout">
          {fleet.map(({ receiver, status }) => {
            const state = rolloutState(status?.snapshot?.appVersionCode, current ?? null);
            return (
              <li
                key={receiver._id}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-medium">{receiver.name}</span>
                <span className="num text-muted">{status?.appVersion ?? "—"}</span>
                {state && (
                  <span
                    className={state === "Up to date" ? "text-ok" : "text-warn"}
                    data-testid="rollout-state"
                  >
                    {state}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

function ReleaseFacts({ release: r, label }: { release: Release; label: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">
        {r.versionName} <span className="num text-muted">({r.versionCode})</span>
        {r.url && (
          <a
            className="ml-2 text-accent underline"
            href={r.url}
            download={`locarc-${r.versionName}.apk`}
          >
            Download APK
          </a>
        )}
      </dd>
      <dt className="text-muted">Commit</dt>
      <dd className="num">{r.commit.slice(0, 12)}</dd>
      <dt className="text-muted">Size</dt>
      <dd className="num">{kb(r.size)}</dd>
      <dt className="text-muted">SHA-256</dt>
      <dd className="num break-all text-xs">{r.sha256}</dd>
      <dt className="text-muted">Built</dt>
      <dd>{dateTime(r.builtAt)}</dd>
      {r.promotedAt && (
        <>
          <dt className="text-muted">Promoted</dt>
          <dd>
            {dateTime(r.promotedAt)} by {r.promotedBy}
          </dd>
        </>
      )}
      {r.minSupported !== null && (
        <>
          <dt className="text-muted">Oldest supported</dt>
          <dd className="num">{r.minSupported}</dd>
        </>
      )}
    </dl>
  );
}

function Candidate({ release }: { release: Release }) {
  const promote = useMutation(api.releases.promote);
  const discard = useMutation(api.releases.discard);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const ready = CHECKLIST.every(([key]) => ticked.has(key));
  return (
    <Section title="Candidate">
      <ReleaseFacts release={release} label="Build" />
      <fieldset className="grid gap-1.5" aria-label="Hardware checklist">
        <legend className="mb-1 text-sm font-medium">
          Hardware checklist, on a real phone + HackRF
        </legend>
        {CHECKLIST.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ticked.has(key)}
              onChange={(e) => {
                const next = new Set(ticked);
                if (e.target.checked) next.add(key);
                else next.delete(key);
                setTicked(next);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() =>
            promote({ releaseId: release._id, checklist: [...ticked] }).then(
              () => toast.success(`${release.versionName} promoted: Receivers update on Wi-Fi`),
              toast.error,
            )
          }
        >
          Promote
        </Button>
        <Button
          variant="ghost"
          onClick={() => discard({ releaseId: release._id }).catch(toast.error)}
        >
          Discard candidate
        </Button>
      </div>
    </Section>
  );
}
