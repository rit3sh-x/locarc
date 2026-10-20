import { useMutation, useQuery } from "convex/react";
import { useActionState, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyField } from "../components/copy-field";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Input, Label } from "../components/ui/input";
import { toast } from "../components/ui/toast";
import { errorMessage } from "../lib/errors";
import { relative, useNow } from "../lib/time";
import { Section } from "./settings";

export function TeamPage() {
  const team = useQuery(api.team.list);
  const now = useNow(60_000);
  const createInvite = useMutation(api.team.createInvite);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const createResetLink = useMutation(api.team.createResetLink);
  const [resetLink, setResetLink] = useState<{ name: string; link: string } | null>(null);

  const [invite, submitInvite, inviting] = useActionState(
    async (
      _: { link?: string; error?: string },
      form: FormData,
    ): Promise<{ link?: string; error?: string }> => {
      try {
        return { link: await createInvite({ email: String(form.get("email")) }) };
      } catch (e) {
        return { error: errorMessage(e) };
      }
    },
    {},
  );

  if (!team) return null;
  const last = team.operators.length === 1;
  const pending = team.invites.filter((i) => i.expiresAt > now);

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Team</h1>
      <Section title="Operators">
        <ul className="divide-y divide-line">
          {team.operators.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {o.name} {o.isMe && <span className="text-muted">(you)</span>}
                </div>
                <div className="truncate text-muted">{o.email}</div>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    setResetLink({
                      name: o.name,
                      link: await createResetLink({ operatorId: o.id }),
                    });
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                Reset link
              </Button>
              <RemoveOperator id={o.id} name={o.name} disabled={last} />
            </li>
          ))}
        </ul>
        {last && <p className="text-muted">The last Operator can't be removed.</p>}
      </Section>

      <Section title="Invite a teammate">
        <form action={submitInvite} className="flex flex-wrap items-end gap-2">
          <Label className="min-w-56 flex-1">
            Email
            <Input name="email" type="email" required />
          </Label>
          <Button type="submit" variant="primary" disabled={inviting}>
            Create invite link
          </Button>
        </form>
        {invite.error && (
          <p role="alert" className="text-crit">
            {invite.error}
          </p>
        )}
        {invite.link && (
          <div className="grid gap-1">
            <CopyField label="Invite link" value={invite.link} />
            <p className="text-muted">Works once, for 7 days. Send it to them yourself.</p>
          </div>
        )}
      </Section>

      <Section title="Pending invites">
        {pending.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-muted">
                  expires {relative(i.expiresAt, now)} · by {i.createdBy}
                </span>
                <Button
                  size="sm"
                  onClick={() => revokeInvite({ inviteId: i.id }).catch(toast.error)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Dialog open={resetLink !== null} onOpenChange={(open) => !open && setResetLink(null)}>
        <DialogContent
          title={`Reset link for ${resetLink?.name ?? ""}`}
          description="Works once, for 1 hour. Send it to them yourself."
        >
          <CopyField label="Reset link" value={resetLink?.link ?? ""} />
          <DialogFooter>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveOperator({
  id,
  name,
  disabled,
}: {
  id: Id<"operators">;
  name: string;
  disabled: boolean;
}) {
  const remove = useMutation(api.team.removeOperator);
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        Remove
      </Button>
      <DialogContent
        title={`Remove ${name}?`}
        description="They are signed out everywhere at once and need a new invite to come back."
      >
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await remove({ operatorId: id });
                setOpen(false);
                toast.success(`${name} removed`);
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
