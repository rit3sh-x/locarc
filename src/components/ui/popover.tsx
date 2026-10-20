import { Popover as P } from "@base-ui/react/popover";
import { cn } from "cn";
import type { ReactNode } from "react";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({
  children,
  align = "center",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <P.Portal>
      <P.Positioner align={align} sideOffset={8} className="z-50">
        <P.Popup
          className={cn(
            "w-[min(92vw,22rem)] rounded-lg border border-line bg-surface p-4 text-ink shadow-lg outline-none",
            className,
          )}
        >
          {children}
        </P.Popup>
      </P.Positioner>
    </P.Portal>
  );
}
