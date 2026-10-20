import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useActionState, useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { authClient } from "../lib/auth";
import { AuthCard } from "./sign-in";

export function InvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const invite = useQuery(api.team.invite, { token });
  const { isAuthenticated } = useConvexAuth();
  const navigate = useNavigate();

  const [error, submit, pending] = useActionState(async (_: string | null, form: FormData) => {
    const { error } = await authClient.signUp.email({
      email: invite?.email ?? "",
      name: String(form.get("name")),
      password: String(form.get("password")),
      fetchOptions: { headers: { "x-invite-token": token } },
    });
    return error ? (error.message ?? "Couldn't create your account.") : null;
  }, null);

  useEffect(() => {
    if (isAuthenticated && !pending) void navigate({ to: "/" });
  }, [isAuthenticated, pending, navigate]);

  if (invite === undefined) return null;
  if (invite === null || invite.expiresAt < Date.now()) {
    return (
      <AuthCard title="Invite not valid">
        <p>This invite link is invalid or has expired. Ask a teammate for a new one.</p>
        <Link to="/sign-in" className="text-accent underline">
          Go to sign-in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Join Locarc">
      <form action={submit} className="grid grid-cols-1 gap-4">
        <Label>
          Email
          <Input value={invite.email} readOnly />
        </Label>
        <Label>
          Your name
          <Input name="name" autoComplete="name" required />
        </Label>
        <Label>
          Password
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Label>
        {error && (
          <p role="alert" className="text-crit">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
