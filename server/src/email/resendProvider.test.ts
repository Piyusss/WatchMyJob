// The pipeline's retry/backoff/dead-letter behaviour keys entirely off
// whether send() resolves or throws, so each failure mode is covered here:
// a silent failure would look like a successful send and the notification
// would be marked PROVIDER_ACCEPTED having never left the building.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResendEmailProvider } from "./resendProvider.js";
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

describe("ResendEmailProvider", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts the message and returns the provider's message id", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    mockFetch(200, JSON.stringify({ id: "re_abc123" }), (url, init) => {
      seenUrl = url;
      seenInit = init;
    });

    const result = await new ResendEmailProvider("re_test_key", "JobDrop <alerts@example.test>").send(message);

    assert.equal(result.providerMessageId, "re_abc123");
    assert.equal(seenUrl, "https://api.resend.com/emails");
    assert.equal(seenInit?.method, "POST");

    const headers = seenInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_test_key");

    const sent = JSON.parse(String(seenInit?.body));
    assert.equal(sent.from, "JobDrop <alerts@example.test>");
    assert.deepEqual(sent.to, ["candidate@example.test"]);
    assert.equal(sent.subject, message.subject);
    assert.equal(sent.html, message.html);
    assert.equal(sent.text, message.text);
  });

  it("throws on a rejected send, surfacing Resend's own error message", async () => {
    mockFetch(422, JSON.stringify({ name: "validation_error", message: "The from address is not verified" }));

    await assert.rejects(
      () => new ResendEmailProvider("re_test_key", "bad@example.test").send(message),
      /validation_error: The from address is not verified/,
    );
  });

  it("never puts the API key in a thrown error", async () => {
    mockFetch(401, JSON.stringify({ message: "Invalid API key" }));

    const err = await new ResendEmailProvider("re_super_secret_key", "a@example.test")
      .send(message)
      .then(() => null)
      .catch((e: Error) => e);

    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /re_super_secret_key/);
  });

  it("throws on a non-JSON error body rather than crashing on the parse", async () => {
    mockFetch(502, "<html>Bad Gateway</html>");
    await assert.rejects(() => new ResendEmailProvider("k", "a@example.test").send(message), /502/);
  });

  it("throws when the request fails at the network level", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => new ResendEmailProvider("k", "a@example.test").send(message),
      /Resend request failed: ECONNREFUSED/,
    );
  });

  it("throws a timeout error when the request is aborted", async () => {
    globalThis.fetch = (async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    await assert.rejects(() => new ResendEmailProvider("k", "a@example.test").send(message), /timed out/);
  });

  it("treats a 2xx with an unparseable body as sent, not as a failure to retry", async () => {
    // Retrying a send the provider actually accepted is how duplicate emails
    // happen: this product's own priorities favour an unknown id over that.
    mockFetch(200, "not json");
    const result = await new ResendEmailProvider("k", "a@example.test").send(message);
    assert.equal(result.providerMessageId, null);
  });
});
