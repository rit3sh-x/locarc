import { useRouter, useSearch } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useActionState, useEffect } from "react";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { authClient, safeRedirect } from "../lib/auth";

export function SignInPage() {
  const { redirect } = useSearch({ from: "/sign-in" });
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.history.replace(safeRedirect(redirect));
  }, [isAuthenticated, redirect, router]);

  // React resets the form after an action; echoing the email back keeps it filled.
  const [state, submit, pending] = useActionState(
    async (_: { email: string; error: string | null }, form: FormData) => {
      const email = String(form.get("email"));
      const { error } = await authClient.signIn.email({
        email,
        password: String(form.get("password")),
      });
      return { email, error: error ? (error.message ?? "Sign-in failed.") : null };
    },
    { email: "", error: null },
  );

  return (
    <AuthCard title="Sign in to Locarc">
      <form action={submit} className="grid grid-cols-1 gap-4">
        <Label>
          Email
          <Input
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={state.email}
            required
          />
        </Label>
        <Label>
          Password
          <Input name="password" type="password" autoComplete="current-password" required />
        </Label>
        {state.error && (
          <p role="alert" className="text-crit">
            {state.error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="grid w-full max-w-sm gap-5 rounded-lg border border-line bg-surface p-6">
        <h1 className="text-lg">{title}</h1>
        {children}
      </div>
    </main>
  );
}
