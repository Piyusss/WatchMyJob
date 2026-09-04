"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import AuthShell from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiFetch, ApiError, type PublicUser } from "@/lib/api";
import { invalidateCurrentUser } from "@/lib/useCurrentUser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ user: PublicUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      // Whoever was cached before this point is not who is signed in now.
      invalidateCurrentUser();
      router.push(res.user.hasPreferences ? "/dashboard" : "/preferences?onboarding=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1.5 text-[0.88rem] text-ink-muted">Log in to manage your job alerts.</p>

      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            className="h-9 bg-surface"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            className="h-9 bg-surface"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" size="lg" disabled={submitting} className="mt-1 h-10 w-full">
          {submitting ? "Logging in…" : "Log in"}
        </Button>

        <p className="text-center text-[0.85rem] text-ink-muted">
          New to JobDrop?{" "}
          <Link href="/register" className="font-medium text-brand-ink underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
