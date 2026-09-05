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

// Also used on attribute values (href, src): it escapes the characters that
// matter for both contexts (quotes included), and none of this content is
// ever attacker-controlled markup, only plain strings interpolated into it.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Matches the README's own worked example content (Section 30):
// Company / Role / Level / Location / Work Mode / Opportunity Type, a
// [View Job] link, and (Section 35 / deliverability practice) a working
// unsubscribe link, not a decorative one.
//
// The HTML is a plain inline-styled table layout, deliberately: email
// clients (Outlook's Word rendering engine especially) don't reliably
// support external stylesheets, flexbox, or grid, so tables + inline
// `style` attributes are still the only layout approach that renders
// consistently everywhere.
//
// Content only: callers add `to`, matching verificationEmail's pattern
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
    "WatchmyJob.co",
    "",
    "New Job Match",
    "",
    ...knownLines.map(([label, value]) => `${label}: ${value}`),
    "",
    `View job: ${input.jobUrl}`,
    "",
    "---",
    `Don't want these emails? Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  const jobUrl = escapeHtml(input.jobUrl);
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  const detailRows = knownLines
    .map(
      ([label, value], i) => `<tr>
        <td style="padding:10px 0;border-top:${i === 0 ? "none" : "1px solid #f0f0f0"};font-size:13px;color:#5c5c5c;white-space:nowrap;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:10px 0 10px 16px;border-top:${i === 0 ? "none" : "1px solid #f0f0f0"};font-size:14px;color:#1e1e1e;font-weight:600;text-align:right;">
          ${escapeHtml(value)}
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New job match</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e2e2e2;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 24px 20px;">
                <span style="font-size:18px;font-weight:700;color:#00497a;letter-spacing:-0.01em;">WatchmyJob.co</span>
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px;">
                <hr style="border:none;border-top:1px solid #f0f0f0;margin:0;" />
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 4px;font-size:13px;color:#5c5c5c;">Hi ${escapeHtml(input.userName)},</p>
                <h1 style="margin:6px 0 0;font-size:21px;line-height:1.3;color:#1e1e1e;">
                  A new role just opened at ${escapeHtml(input.companyName)}
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 32px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${detailRows}
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:28px 32px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="border-radius:8px;background-color:#007acc;">
                      <a
                        href="${jobUrl}"
                        style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;"
                      >
                        View job
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9a9a9a;">
                  You're getting this because you're watching ${escapeHtml(input.companyName)} on WatchmyJob.co.
                  <a href="${unsubscribeUrl}" style="color:#5c5c5c;text-decoration:underline;">Unsubscribe</a>
                  from these alerts anytime.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: `New job match: ${input.roleFamily ?? input.jobTitle} at ${input.companyName}`,
    text,
    html,
  };
}
