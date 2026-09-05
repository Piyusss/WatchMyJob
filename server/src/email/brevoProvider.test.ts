import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BrevoEmailProvider } from "./brevoProvider.js";
import type { EmailMessage } from "./types.js";

const originalFetch = globalThis.fetch;

const message: EmailMessage = {
  to: "candidate@example.test",
  subject: "New role at Stripe matches your preferences",
  html: "<p>hello</p>",
  text: "hello",
};

function mockFetch(status: number, body: string, capture?: (url: string, init: RequestInit) => void) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("BrevoEmailProvider", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts the message and returns the provider's message id", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    mockFetch(201, JSON.stringify({ messageId: "<abc123@smtp-relay.mailin.fr>" }), (url, init) => {
      seenUrl = url;
      seenInit = init;
    });

    const result = await new BrevoEmailProvider("xkeysib-test", "alerts@example.test", "JobDrop").send(message);

    assert.equal(result.providerMessageId, "<abc123@smtp-relay.mailin.fr>");
    assert.equal(seenUrl, "https://api.brevo.com/v3/smtp/email");
    assert.equal(seenInit?.method, "POST");

    const headers = seenInit?.headers as Record<string, string>;
    assert.equal(headers["api-key"], "xkeysib-test");

    const sent = JSON.parse(String(seenInit?.body));
    assert.deepEqual(sent.sender, { email: "alerts@example.test", name: "JobDrop" });
    assert.deepEqual(sent.to, [{ email: "candidate@example.test" }]);
    assert.equal(sent.subject, message.subject);
    assert.equal(sent.htmlContent, message.html);
    assert.equal(sent.textContent, message.text);
  });

  it("accepts a 202 (scheduled) the same as a 201", async () => {
    mockFetch(202, JSON.stringify({ messageId: "abc" }));
    const result = await new BrevoEmailProvider("k", "a@example.test", "JobDrop").send(message);
    assert.equal(result.providerMessageId, "abc");
  });

  it("throws on a rejected send, surfacing Brevo's own error message", async () => {
    mockFetch(400, JSON.stringify({ code: "invalid_parameter", message: "Sender not verified" }));

    await assert.rejects(
      () => new BrevoEmailProvider("k", "unverified@example.test", "JobDrop").send(message),
      /invalid_parameter: Sender not verified/,
    );
  });

  it("never puts the API key in a thrown error", async () => {
    mockFetch(401, JSON.stringify({ code: "unauthorized", message: "Key not found" }));

    const err = await new BrevoEmailProvider("xkeysib-super-secret", "a@example.test", "JobDrop")
      .send(message)
      .then(() => null)
      .catch((e: Error) => e);

    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /xkeysib-super-secret/);
  });

  it("throws on a non-JSON error body rather than crashing on the parse", async () => {
    mockFetch(502, "<html>Bad Gateway</html>");
    await assert.rejects(() => new BrevoEmailProvider("k", "a@example.test", "JobDrop").send(message), /502/);
  });

  it("throws when the request fails at the network level", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => new BrevoEmailProvider("k", "a@example.test", "JobDrop").send(message),
      /Brevo request failed: ECONNREFUSED/,
    );
  });

  it("throws a timeout error when the request is aborted", async () => {
    globalThis.fetch = (async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    await assert.rejects(() => new BrevoEmailProvider("k", "a@example.test", "JobDrop").send(message), /timed out/);
  });

  it("treats a 2xx with an unparseable body as sent, not as a failure to retry", async () => {
    mockFetch(201, "not json");
    const result = await new BrevoEmailProvider("k", "a@example.test", "JobDrop").send(message);
    assert.equal(result.providerMessageId, null);
  });
});
