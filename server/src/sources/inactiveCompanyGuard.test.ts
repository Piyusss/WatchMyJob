// Covers another confirmed Phase 5 audit finding: neither syncCompany nor
// runInitialSync checked company.status before, so a deactivated company
// (ToS revoked, broken adapter, cap rebalance) could keep silently
// accumulating jobs in the background -- exactly the kind of stale,
// unattended sync gap that later floods whoever is still subscribed.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncCompany, runInitialSync } from "./sync.js";

const SLUG = `test-inactiveguard-${Date.now()}`;
let companyId: string;

describe("inactive-company sync guard", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "Inactive Guard Test Co", slug: SLUG, accessBasis: "OFFICIAL_API", status: "INACTIVE" },
    });
    companyId = company.id;
    await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
  });

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("syncCompany refuses to run against a deactivated company", async () => {
    await assert.rejects(() => syncCompany(SLUG), /INACTIVE/);
  });

  it("runInitialSync refuses to run against a deactivated company", async () => {
    await assert.rejects(() => runInitialSync(SLUG), /INACTIVE/);
  });

  it("reactivating the company allows sync to proceed again (guard is on status, not permanent)", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });
    // GREENHOUSE adapter will actually attempt a network call and fail
    // (bogus token) -- that's fine, we're only asserting the ACTIVE-company
    // guard no longer throws before reaching the sync logic.
    const results = await runInitialSync(SLUG, { allowEmpty: true });
    assert.equal(results.length, 1);
  });
});
