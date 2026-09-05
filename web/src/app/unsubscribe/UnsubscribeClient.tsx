"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import StatusScreen from "@/components/StatusScreen";

type Status = "working" | "success" | "error";

export default function UnsubscribeClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState("One moment…");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This unsubscribe link is missing its token.");
      return;
    }

    // Idempotent by design (see schema.prisma's unsubscribeToken comment):
    // no need to guard against firing twice the way verify-email's
    // single-use token does.
    apiFetch<{ notificationsPaused: boolean }>("/api/notifications/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus("success");
        setMessage("You won't receive any more job alert emails. You can turn them back on anytime from Settings.");
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "This unsubscribe link is invalid.");
      });
  }, [token]);

  return (
    <StatusScreen
      tone={status === "working" ? "pending" : status}
      title={status === "success" ? "Unsubscribed" : "Unsubscribe"}
      message={message}
      actionHref="/login"
      actionLabel="Back to GettingShortlisted.in"
    />
  );
}
