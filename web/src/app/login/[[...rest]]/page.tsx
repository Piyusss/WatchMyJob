import { SignIn } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

// Registration/login/verification/reset are entirely Clerk's now (Google +
// email/password, both configured in the Clerk dashboard) -- see
// server/src/auth/authenticate.ts for how a Clerk session resolves to a
// local User row. AuthShell keeps the brand panel; the form itself is
// Clerk's own component, themed via ClerkProvider's appearance prop in
// layout.tsx.
//
// This route is an optional catch-all ([[...rest]]) rather than a plain
// page.tsx: Clerk's OAuth (Google) flow redirects back through sub-paths
// like /login/sso-callback, which 404 against a fixed route -- the
// catch-all lets those resolve here, and SignIn's own path-based routing
// handles the sub-path client-side.
export default function LoginPage() {
  return (
    <AuthShell>
      <SignIn path="/login" signUpUrl="/register" forceRedirectUrl="/dashboard" />
    </AuthShell>
  );
}
