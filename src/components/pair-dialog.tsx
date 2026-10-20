import { useMutation, useQuery } from "convex/react";
import { CheckCircle2 } from "lucide-react";
import { useActionState, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatPairingCode, PAIRING_TTL_MS, pairingUri } from "@/convex/lib/pairing";
import { env } from "../env";
import { errorMessage } from "../lib/errors";
import { useNow } from "../lib/time";
import { Qr } from "./qr";
import { Button } from "./ui/button";
import { DialogClose, DialogContent, DialogFooter } from "./ui/dialog";
import { Input, Label } from "./ui/input";
import { toast } from "./ui/toast";

type Issued = { receiverId: Id<"receivers">; code: string; expiresAt: number };

/** Content for a Dialog: name a new Receiver, or re-pair `repair`; then show its code. */
export function PairDialogContent({ repair }: { repair?: { id: Id<"receivers">; name: string } }) {
  const createPending = useMutation(api.receivers.createPending);
  const repairMutation = useMutation(api.receivers.repair);
  const [issued, setIssued] = useState<Issued | null>(null);

  const [error, submit, pending] = useActionState(async (_: string | null, form: FormData) => {
    try {
      setIssued(await createPending({ name: String(form.get("name")) }));
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }, null);

  const issueRepair = async () => {
    if (!repair) return;
    try {
      setIssued({ receiverId: repair.id, ...(await repairMutation({ receiverId: repair.id })) });
    } catch (e) {
      toast.error(e);
    }
  };

  if (issued) return <CodeStep issued={issued} repairName={repair?.name} onRenew={issueRepair} />;

  if (repair) {
    return (
      <DialogContent
        title={`Re-pair ${repair.name}`}
        description="The new phone keeps this Receiver's name, config, pin and history. The phone paired now is cut off as soon as the new one redeems the code."
      >
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" onClick={issueRepair}>
            Show pairing code
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent title="Pair Receiver" description="Name the phone + HackRF you're adding.">
      <form action={submit} className="grid grid-cols-1 gap-4">
        <Label>
          Name
          <Input name="name" required maxLength={40} placeholder="e.g. Rooftop A" />
        </Label>
        {error && (
          <p role="alert" className="text-crit">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button type="submit" variant="primary" disabled={pending}>
            Create pairing code
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function CodeStep({
  issued,
  repairName,
  onRenew,
}: {
  issued: Issued;
  repairName?: string;
  onRenew: () => void;
}) {
  const now = useNow(1000);
  const receivers = useQuery(api.receivers.list);
  const receiver = receivers?.find((r) => r._id === issued.receiverId);
  const issuedAt = issued.expiresAt - PAIRING_TTL_MS;
  const paired = receiver?.pairedAt != null && receiver.pairedAt >= issuedAt;
  const left = Math.max(0, issued.expiresAt - now);
  const mmss = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;

  return (
    <DialogContent title={paired ? "Paired" : `Pair ${receiver?.name ?? repairName ?? ""}`}>
      {paired ? (
        <p className="flex items-center gap-2 text-ok" role="status">
          <CheckCircle2 className="size-5" /> {receiver?.name} is paired.
        </p>
      ) : left === 0 ? (
        <div className="grid justify-items-start gap-2">
          <p role="status">This code has expired.</p>
          {repairName !== undefined || receiver ? (
            <Button onClick={onRenew}>New code</Button>
          ) : null}
        </div>
      ) : (
        <div className="grid justify-items-center gap-3">
          <Qr text={pairingUri(env.VITE_CONVEX_URL, issued.code)} label="Pairing QR code" />
          <p className="text-muted">Scan in the Locarc app, or type</p>
          <p className="num text-2xl font-medium tracking-widest" data-testid="pairing-code">
            {formatPairingCode(issued.code)}
          </p>
          <p className="text-muted" role="status">
            Waiting for the phone… <span className="num">{mmss}</span>
          </p>
          {repairName && <p className="text-warn">The phone paired now will be cut off.</p>}
        </div>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant={paired ? "primary" : "secondary"} />}>
          {paired ? "Done" : "Close"}
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
