import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { errorMessage } from "../../lib/errors";
import { reportError } from "../../lib/report";

const manager = Toast.createToastManager();

export const toast = {
  success: (title: string, description?: string) =>
    manager.add({ title, description, type: "success" }),
  error: (e: unknown) => {
    // Business errors (ConvexError codes) are explained in the toast; anything else is a bug.
    reportError(e);
    return manager.add({ title: errorMessage(e), type: "error", priority: "high" });
  },
};

export function Toaster() {
  return (
    <Toast.Provider toastManager={manager} timeout={5000}>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-4 bottom-4 z-[60] grid w-[min(92vw,24rem)] gap-2">
          <Toasts />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function Toasts() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className="flex items-start gap-3 rounded-md border border-line bg-surface p-3 shadow-lg data-[type=error]:border-crit"
    >
      <Toast.Content className="grid flex-1 gap-0.5">
        <Toast.Title className="font-medium" />
        <Toast.Description className="text-muted" />
      </Toast.Content>
      <Toast.Close aria-label="Dismiss" className="text-muted hover:text-ink">
        <X className="size-4" />
      </Toast.Close>
    </Toast.Root>
  ));
}
