import { Suspense } from "react";
import TestCompaniesClient from "./TestCompaniesClient";

export default function TestCompaniesPage() {
  return (
    <Suspense fallback={null}>
      <TestCompaniesClient />
    </Suspense>
  );
}
