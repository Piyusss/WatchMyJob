import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

// Registration/login/verification/reset are entirely Clerk's now (Google +
// email/password, both configured in the Clerk dashboard): see
// server/src/auth/authenticate.ts for how a Clerk session resolves to a
// local User row. AuthShell centers the card; the form itself is Clerk's own
// component, themed via ClerkProvider's appearance prop in layout.tsx.
//
// This route is an optional catch-all ([[...rest]]) rather than a plain
// page.tsx: Clerk's OAuth (Google) flow redirects back through sub-paths
// like /login/sso-callback, which 404 against a fixed route: the
// catch-all lets those resolve here, and SignIn's own path-based routing
// handles the sub-path client-side.
//
// Clerk's default footer bundles the "Sign up" prompt together with its own
// "Secured by Clerk" / "Development mode" branding as one block: there's
// no supported way to hide just the branding half. Hiding the whole footer
// and rebuilding the sign-up prompt below keeps the former without the
// latter.
export default function LoginPage() {
  return (
    <AuthShell>
      <SignIn
        path="/login"
        signUpUrl="/register"
        forceRedirectUrl="/companies"
        appearance={{ elements: { footer: { display: "none" } } }}
      />
      <p className="mt-6 text-center text-[0.85rem] text-ink-muted">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-brand-ink hover:underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
