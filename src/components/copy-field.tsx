import { Copy } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "./ui/toast";

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        aria-label={label}
        value={value}
        className="num text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          toast.success("Copied");
        }}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}
