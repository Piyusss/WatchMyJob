import type { Prisma } from "@prisma/client";

// A company may only be watched once every one of its sources has a
// committed baseline. Until then its existing openings would arrive with a
// firstSeenAt later than the subscription, and the notify predicate would
// read the company's entire back catalogue as brand-new.
//
// Defined once and shared by the company listing and the subscribe
// endpoint: two copies of this rule that drift apart is itself the hole.
export const SELECTABLE_COMPANY: Prisma.CompanyWhereInput = {
  status: "ACTIVE",
  sources: { some: {} },
  // ...and not a single one still missing its baseline.
  NOT: { sources: { some: { initialSyncCompletedAt: null } } },
};
