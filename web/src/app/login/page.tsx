import { SignIn } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

// Registration/login/verification/reset are entirely Clerk's now (Google +
// email/password, both configured in the Clerk dashboard) -- see
// server/src/auth/authenticate.ts for how a Clerk session resolves to a
// local User row. AuthShell keeps the brand panel; the form itself is
// Clerk's own component, themed via ClerkProvider's appearance prop in
// layout.tsx.
export default function LoginPage() {
  return (
    <AuthShell>
      <SignIn signUpUrl="/register" forceRedirectUrl="/dashboard" />
    </AuthShell>
  );
}
