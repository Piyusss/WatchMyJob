type EmailContent = { subject: string; text: string; html: string };

export interface JobMatchEmailInput {
  userName: string;
  companyName: string;
  jobTitle: string;
  roleFamily: string | null;
  level: string | null;
  location: string | null;
  workMode: string | null;
  opportunityType: string;
  jobUrl: string;
  unsubscribeUrl: string;
}

const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "Full-time",
  INTERNSHIP: "Internship",
  CONTRACT: "Contract",
  PART_TIME: "Part-time",
  OTHER: "Other",
};

const WORK_MODE_LABELS: Record<string, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ON_SITE: "On-site",
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Matches the README's own worked example content (Section 30) --
// Company / Role / Level / Location / Work Mode / Opportunity Type, a
// [View Job] link, and (Section 35 / deliverability practice) a working
// unsubscribe link, not a decorative one.
// Content only -- callers add `to`, matching verificationEmail's pattern
// (auth/routes.ts: `{ to: user.email, ...message }`).
export function jobMatchEmail(input: JobMatchEmailInput): EmailContent {
  const opportunityLabel = OPPORTUNITY_TYPE_LABELS[input.opportunityType] ?? input.opportunityType;
  const workModeLabel = input.workMode ? WORK_MODE_LABELS[input.workMode] ?? input.workMode : null;

  const lines: [string, string | null][] = [
    ["Company", input.companyName],
    ["Role", input.roleFamily ?? input.jobTitle],
    ["Level", input.level],
    ["Location", input.location],
    ["Work Mode", workModeLabel],
    ["Opportunity Type", opportunityLabel],
  ];
  const knownLines = lines.filter((l): l is [string, string] => l[1] !== null);

  const text = [
    "New Job Match",
    "",
    ...knownLines.map(([label, value]) => `${label}: ${value}`),
    "",
    `View job: ${input.jobUrl}`,
    "",
    `Don't want these emails? Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(input.userName)},</p>
    <h2>New Job Match</h2>
    <table cellpadding="4" cellspacing="0">
      ${knownLines
        .map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`)
        .join("")}
    </table>
    <p><a href="${input.jobUrl}">View Job</a></p>
    <p style="color:#888;font-size:12px;">
      Don't want these emails? <a href="${input.unsubscribeUrl}">Unsubscribe</a>.
    </p>
  `.trim();

  return {
    subject: `New job match: ${input.roleFamily ?? input.jobTitle} at ${input.companyName}`,
    text,
    html,
  };
}
