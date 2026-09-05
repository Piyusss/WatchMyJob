import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

// See login/page.tsx: same catch-all-route reasoning (Clerk's OAuth
// callback sub-paths need to resolve here) and the same footer-hiding
// reasoning (Clerk bundles "Secured by Clerk" / "Development mode" into the
// same footer block as the sign-in prompt, with no way to hide just the
// branding). New signups always land on onboarding: mirrors the old
// custom register flow's unconditional redirect to /preferences?onboarding=1,
// whereas login (an existing, presumably already-onboarded user) goes
// straight to /companies.
export default function RegisterPage() {
  return (
    <AuthShell>
      <SignUp
        path="/register"
        signInUrl="/login"
        forceRedirectUrl="/preferences?onboarding=1"
        appearance={{ elements: { footer: { display: "none" } } }}
      />
      <p className="mt-6 text-center text-[0.85rem] text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-ink hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
