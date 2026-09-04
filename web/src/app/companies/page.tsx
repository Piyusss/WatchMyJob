import { Suspense } from "react";
import CompaniesClient from "./CompaniesClient";

export default function CompaniesPage() {
  return (
    <Suspense fallback={null}>
      <CompaniesClient />
    </Suspense>
  );
}
