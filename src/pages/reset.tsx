import { Link, useParams } from "@tanstack/react-router";
import { useActionState } from "react";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { authClient } from "../lib/auth";
import { AuthCard } from "./sign-in";

export function ResetPage() {
  const { token } = useParams({ from: "/reset/$token" });
  const [state, submit, pending] = useActionState(
    async (
      _: { done?: boolean; error?: string },
      form: FormData,
    ): Promise<{ done?: boolean; error?: string }> => {
      const password = String(form.get("password"));
      if (password !== String(form.get("confirm"))) return { error: "The passwords don't match." };
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      return error ? { error: "This reset link is invalid or has expired." } : { done: true };
    },
    {},
  );

  if (state.done) {
    return (
      <AuthCard title="Password changed">
        <Link to="/sign-in" className="text-accent underline">
          Sign in with your new password
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <form action={submit} className="grid grid-cols-1 gap-4">
        <Label>
          New password
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Label>
        <Label>
          Repeat it
          <Input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Label>
        {state.error && (
          <p role="alert" className="text-crit">
            {state.error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
