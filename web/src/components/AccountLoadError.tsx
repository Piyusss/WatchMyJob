"use client";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Shown when /api/auth/me fails for a reason that isn't "signed out" -- a
// server error, a rate limit, an unreachable API. Previously these were all
// treated as a 401 and redirected to /login, which produced an endless
// bounce between /login and /dashboard (see useCurrentUser). Telling the
// user the server is unhappy is both honest and, unlike the redirect, a
// dead end rather than a loop.
export default function AccountLoadError({ message }: { message: string }) {
  return (
    <main className="container-app grid min-h-[60vh] place-items-center py-10">
      <div className="w-full max-w-md text-center">
        <Alert variant="destructive" className="text-left">
          <AlertCircle />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button className="mt-5" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
