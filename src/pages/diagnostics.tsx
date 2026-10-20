import { cn } from "cn";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "../components/ui/button";
import { toast } from "../components/ui/toast";
import { dateTime, relative, useNow } from "../lib/time";
import { Section } from "./settings";

/** Errors from the website, the server and Receivers, grouped by fingerprint (kept 30 days). */
export function DiagnosticsPage() {
  const errors = useQuery(api.errors.list);
  const resolve = useMutation(api.errors.resolve);
  const now = useNow(30_000);
  if (!errors) return null;
  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Diagnostics</h1>
      <Section title="Errors">
        {errors.length === 0 ? (
          <p className="text-muted">No errors in the last 30 days.</p>
        ) : (
          <ul className="-mx-3 divide-y divide-line" data-testid="error-groups">
            {errors.map((e) => (
              <li key={e._id} className="grid gap-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 text-xs",
                      e.source === "android"
                        ? "border-accent/40 text-accent"
                        : e.source === "server"
                          ? "border-warn/45 text-warn"
                          : "border-line",
                    )}
                  >
                    {e.source}
                  </span>
                  <span className="font-medium">{e.kind}</span>
                  <span className="min-w-0 truncate">{e.message}</span>
                  <span className="num ml-auto text-xs text-muted">×{e.count}</span>
                  {e.resolvedAt ? (
                    <span className="text-xs text-ok">resolved</span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => resolve({ errorId: e._id }).catch(toast.error)}
                    >
                      Resolve
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted">
                  first {dateTime(e.firstAt)} · last {relative(e.lastAt, now)} · version{" "}
                  <span className="num">{e.latestVersion}</span> · {e.latestContext}
                </p>
                {e.sampleStack && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted">Sample stack</summary>
                    <pre className="num mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-xs whitespace-pre-wrap">
                      {e.sampleStack}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
