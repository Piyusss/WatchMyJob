// Exercises the SES/SNS delivery-feedback webhook end to end through a real
// Fastify instance (route registration, the text/plain content-type parser,
// the SNS-envelope/SES-event parsing, and the resulting DB writes): not
// just the inner logic in isolation, since the content-type parser wiring
// is itself something that's broken before (SNS's text/plain quirk is easy
// to get wrong) and is worth covering as a real HTTP request.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { webhookRoutes } from "./webhooks.js";

let app: FastifyInstance;
let userId: string;
let companyId: string;
let sourceId: string;
let jobCounter = 0;

function snsBody(sesEvent: unknown) {
  return JSON.stringify({
    Type: "Notification",
    Message: JSON.stringify(sesEvent),
    MessageId: "sns-envelope-id",
    TopicArn: "arn:aws:sns:us-east-1:000000000000:test",
  });
}

// A fresh Job per call rather than reusing one: Notification is unique on
// (userId, jobId, notificationType), and every test in this file uses the
// same user and the same notificationType.
async function makeNotification(providerMessageId: string) {
  jobCounter++;
  const job = await prisma.job.create({
    data: {
      companyId,
      sourceId,
      externalJobId: `webhook-job-${jobCounter}`,
      identityHash: `h${jobCounter}`,
      contentHash: `h${jobCounter}`,
      title: "Test Job",
      sourceUrl: "https://example.test/job",
    },
  });
  return prisma.notification.create({
    data: {
      userId,
      jobId: job.id,
      notificationType: "NEW_JOB",
      status: "PROVIDER_ACCEPTED",
      providerMessageId,
      sentAt: new Date(),
    },
  });
}

describe("SES/SNS delivery-feedback webhook", () => {
  before(async () => {
    app = Fastify();
    await app.register(webhookRoutes);
    await app.ready();

    const suffix = Date.now();
    const user = await prisma.user.create({
      data: { name: "Webhook Test", email: `webhook-${suffix}@example.test`, clerkUserId: `clerk-webhook-${suffix}` },
    });
    userId = user.id;
    const company = await prisma.company.create({
      data: { name: "Webhook Co", slug: `webhook-co-${suffix}`, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    sourceId = source.id;
  });

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } }); // cascades the source and job
    await prisma.user.delete({ where: { id: userId } }); // cascades notifications
    await app.close();
  });

  it("parses SNS's text/plain content type and marks a Delivery event", async () => {
    const notification = await makeNotification("msg-delivery-1");

    const res = await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: snsBody({ notificationType: "Delivery", mail: { messageId: "msg-delivery-1" } }),
    });

    assert.equal(res.statusCode, 200);
    const updated = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(updated.status, "DELIVERED");
    assert.ok(updated.deliveredAt !== null);
  });

  it("marks a Bounce event and, for a Permanent bounce, suppresses the user's future sends", async () => {
    const notification = await makeNotification("msg-bounce-1");

    const res = await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: snsBody({
        notificationType: "Bounce",
        mail: { messageId: "msg-bounce-1" },
        bounce: { bounceType: "Permanent" },
      }),
    });

    assert.equal(res.statusCode, 200);
    const updatedNotification = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(updatedNotification.status, "BOUNCED");
    assert.ok(updatedNotification.bouncedAt !== null);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.emailHardBounced, true);
  });

  it("does not suppress the user for a Transient bounce", async () => {
    await prisma.user.update({ where: { id: userId }, data: { emailHardBounced: false } });
    await makeNotification("msg-bounce-transient");

    await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: snsBody({
        notificationType: "Bounce",
        mail: { messageId: "msg-bounce-transient" },
        bounce: { bounceType: "Transient" },
      }),
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.emailHardBounced, false);
  });

  it("marks a Complaint event and suppresses future sends the same way a permanent bounce does", async () => {
    await prisma.user.update({ where: { id: userId }, data: { emailHardBounced: false } });
    const notification = await makeNotification("msg-complaint-1");

    await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: snsBody({ notificationType: "Complaint", mail: { messageId: "msg-complaint-1" } }),
    });

    const updatedNotification = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(updatedNotification.status, "COMPLAINED");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.emailHardBounced, true);
  });

  it("acknowledges (200) an event whose messageId matches no known notification, rather than erroring", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: snsBody({ notificationType: "Delivery", mail: { messageId: "no-such-message-id" } }),
    });
    assert.equal(res.statusCode, 200);
  });

  it("acknowledges (200) a SubscriptionConfirmation without erroring", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify({
        Type: "SubscriptionConfirmation",
        Message: "You have chosen to subscribe to the topic...",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirm?token=abc",
      }),
    });
    assert.equal(res.statusCode, 200);
  });

  it("rejects a malformed envelope with 400, not a 500 crash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ses",
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify({ not: "a valid envelope" }),
    });
    assert.equal(res.statusCode, 400);
  });
});
