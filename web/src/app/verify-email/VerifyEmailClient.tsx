"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import StatusScreen from "@/components/StatusScreen";
import { invalidateCurrentUser } from "@/lib/useCurrentUser";

type Status = "verifying" | "success" | "error";

export default function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("Confirming your email…");
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }

    // The token is single-use server-side; guard against firing the request
    // twice for the same token (React StrictMode double-invokes effects in
    // dev, and a remount should never re-spend an already-verified token).
    if (requestedFor.current === token) return;
    requestedFor.current = token;

    apiFetch<{ emailVerified: boolean }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus("success");
        setMessage("Your email is verified. You're all set.");
        // emailVerified just changed -- the dashboard's "verify your email"
        // banner reads it, so the cached copy must not survive.
        invalidateCurrentUser();
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "This verification link is invalid or has expired.");
      });
  }, [token]);

  return (
    <StatusScreen
      tone={status === "verifying" ? "pending" : status}
      title={status === "success" ? "Email verified" : "Verify your email"}
      message={message}
      actionHref="/dashboard"
      actionLabel="Go to dashboard"
    />
  );
}
