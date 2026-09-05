import { parseArgs } from "node:util";
import { prisma } from "../db/prisma.js";
import { AccessBasis, CompanyStatus } from "@prisma/client";
import { deactivateSubscriptionsForCompany } from "../subscriptions/deactivateForCompany.js";

const ACCESS_BASIS_VALUES = Object.values(AccessBasis);

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function addCompany(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      "access-basis": { type: "string" },
      domain: { type: "string" },
    },
  });

  if (!values.name) fail("--name is required");
  const accessBasis = values["access-basis"];
  if (!accessBasis || !ACCESS_BASIS_VALUES.includes(accessBasis as AccessBasis)) {
    fail(`--access-basis must be one of: ${ACCESS_BASIS_VALUES.join(", ")}`);
  }

  const slug = values.slug ? slugify(values.slug) : slugify(values.name);

  const existing = await prisma.company.findUnique({ where: { slug } });
  if (existing) fail(`A company with slug "${slug}" already exists (id: ${existing.id})`);

  const company = await prisma.company.create({
    data: { name: values.name, slug, accessBasis: accessBasis as AccessBasis, domain: values.domain ?? null },
  });

  console.log(`Created company "${company.name}" (slug: ${company.slug}, id: ${company.id})`);
}

async function listCompanies() {
  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sources: true } } },
  });

  if (companies.length === 0) {
    console.log("No companies yet.");
    return;
  }

  // No "(max 50)" here any more: 50 was the original target from
  // companies.txt, never a limit anything enforced, and the allowlist is
  // past it now. Printing a cap that isn't real just invites someone to
  // trust it.
  console.log(`${companies.length} companies:\n`);
  for (const c of companies) {
    console.log(
      `${c.status === "ACTIVE" ? "●" : "○"} ${c.name} (${c.slug}) · ${c.accessBasis} · ${c._count.sources} source(s)`,
    );
  }
}

async function setStatus(argv: string[], status: CompanyStatus) {
  const { values } = parseArgs({ args: argv, options: { slug: { type: "string" } } });
  if (!values.slug) fail("--slug is required");

  const company = await prisma.company.findUnique({ where: { slug: values.slug } });
  if (!company) fail(`No company with slug "${values.slug}"`);

  await prisma.company.update({ where: { slug: values.slug }, data: { status } });

  // A disabled company must stop counting as "watched": left alone, a
  // subscriber's active subscription row would keep feeding the dashboard
  // job query and the matching engine, neither of which checks the
  // company's own status (see subscriptions/deactivateForCompany.ts).
  if (status === "INACTIVE") {
    const count = await deactivateSubscriptionsForCompany(company.id);
    if (count > 0) console.log(`Deactivated ${count} subscriber(s) who were watching ${company.name}.`);
  }

  console.log(`${company.name} is now ${status}.`);
}

async function setDomain(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { slug: { type: "string" }, domain: { type: "string" } } });
  if (!values.slug) fail("--slug is required");
  if (!values.domain) fail("--domain is required");

  const company = await prisma.company.findUnique({ where: { slug: values.slug } });
  if (!company) fail(`No company with slug "${values.slug}"`);

  await prisma.company.update({ where: { slug: values.slug }, data: { domain: values.domain } });
  console.log(`${company.name}'s domain is now ${values.domain}.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "add":
      return addCompany(rest);
    case "list":
      return listCompanies();
    case "activate":
      return setStatus(rest, CompanyStatus.ACTIVE);
    case "deactivate":
      return setStatus(rest, CompanyStatus.INACTIVE);
    case "set-domain":
      return setDomain(rest);
    default:
      console.log("Usage: admin:companies. <add|list|activate|deactivate|set-domain> [options]");
      process.exit(command ? 1 : 0);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
