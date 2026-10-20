import { Menu as M } from "@base-ui/react/menu";
import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuRadioGroup = M.RadioGroup;
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;

export function MenuContent({
  children,
  align = "end",
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <M.Portal>
      <M.Positioner align={align} sideOffset={6} className="z-50">
        <M.Popup className="min-w-52 rounded-md border border-line bg-surface p-1 text-ink shadow-lg outline-none">
          {children}
        </M.Popup>
      </M.Positioner>
    </M.Portal>
  );
}

const item =
  "flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-2";

export function MenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return <M.Item className={cn(item, className)} {...props} />;
}

export function MenuLinkItem({ className, ...props }: ComponentProps<typeof M.LinkItem>) {
  return <M.LinkItem className={cn(item, className)} {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(item, className)} {...props}>
      <span className="grid size-3 place-items-center">
        <M.RadioItemIndicator className="size-1.5 rounded-full bg-accent" />
      </span>
      {children}
    </M.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-2 py-1.5 text-xs text-muted", className)} {...props} />;
}
