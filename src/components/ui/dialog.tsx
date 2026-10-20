import { Dialog as D } from "@base-ui/react/dialog";
import { cn } from "cn";
import type { ReactNode } from "react";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Backdrop className="fixed inset-0 z-50 bg-black/40" />
      <D.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-line bg-surface p-5 text-ink shadow-xl",
          className,
        )}
      >
        <D.Title className="text-base font-semibold">{title}</D.Title>
        {description && <D.Description className="text-muted">{description}</D.Description>}
        {children}
      </D.Popup>
    </D.Portal>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}
