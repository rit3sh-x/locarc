import { cn } from "cn";
import type { ComponentProps } from "react";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-ink placeholder:text-muted disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers nest the control or pass htmlFor
  return <label className={cn("grid gap-1 text-sm font-medium", className)} {...props} />;
}
