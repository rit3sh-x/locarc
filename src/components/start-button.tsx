import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { describeCadence, nextRunStart } from "@/convex/lib/schedule";
import { clock } from "../lib/time";
import { ConfirmDialog } from "./confirm";
import { Button } from "./ui/button";

/** Starts scanning at the Organization's saved cadence (the empty state's next step). */
export function StartButton() {
  const config = useQuery(api.orgConfig.current);
  const start = useMutation(api.runs.start);
  const [open, setOpen] = useState(false);
  if (!config) return null;
  const cadence = config.values.cadence;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Start scanning
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Start scanning?"
        lines={[
          `The Run starts at ${clock(nextRunStart(Date.now()))}.`,
          `Cadence: ${describeCadence(cadence)}.`,
        ]}
        confirmLabel="Start"
        onConfirm={() => start({ cadence })}
      />
    </>
  );
}
