import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "./ui/dialog";
import { toast } from "./ui/toast";

/** The shared diff confirm: what will change, then one explicit button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  lines,
  warnings = [],
  confirmLabel,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  lines: string[];
  warnings?: string[];
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <ul className="grid list-disc gap-1 pl-5" aria-label="Effects">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {warnings.length > 0 && (
          <ul className="grid gap-1 text-warn" aria-label="Warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
