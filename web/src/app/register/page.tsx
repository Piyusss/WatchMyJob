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

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch<{ user: PublicUser }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      invalidateCurrentUser();
      router.push("/preferences?onboarding=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1.5 text-[0.88rem] text-ink-muted">Set your preferences once — we&apos;ll watch the rest.</p>

      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            className="h-9 bg-surface"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
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
            minLength={8}
            autoComplete="new-password"
          />
          <p className="text-[0.78rem] text-ink-faint">At least 8 characters.</p>
        </div>

        <Button type="submit" size="lg" disabled={submitting} className="mt-1 h-10 w-full">
          {submitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-[0.85rem] text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-ink underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
