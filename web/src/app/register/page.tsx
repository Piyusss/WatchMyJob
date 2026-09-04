import { SignUp } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

// See login/page.tsx. New signups always land on onboarding -- mirrors the
// old custom register flow's unconditional redirect to
// /preferences?onboarding=1, whereas login (an existing, presumably
// already-onboarded user) goes straight to /dashboard.
export default function RegisterPage() {
  return (
    <AuthShell>
      <SignUp signInUrl="/login" forceRedirectUrl="/preferences?onboarding=1" />
    </AuthShell>
  );
}
