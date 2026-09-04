import { SignUp } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

// See login/page.tsx -- same catch-all-route reasoning (Clerk's OAuth
// callback sub-paths need to resolve here). New signups always land on
// onboarding -- mirrors the old custom register flow's unconditional
// redirect to /preferences?onboarding=1, whereas login (an existing,
// presumably already-onboarded user) goes straight to /dashboard.
export default function RegisterPage() {
  return (
    <AuthShell>
      <SignUp path="/register" signInUrl="/login" forceRedirectUrl="/preferences?onboarding=1" />
    </AuthShell>
  );
}
