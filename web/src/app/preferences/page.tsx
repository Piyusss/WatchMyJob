import { Suspense } from "react";
import PreferencesClient from "./PreferencesClient";

export default function PreferencesPage() {
  return (
    <Suspense fallback={null}>
      <PreferencesClient />
    </Suspense>
  );
}
