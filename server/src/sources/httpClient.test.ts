import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchJson, SourceFetchError } from "./httpClient.js";

const originalFetch = globalThis.fetch;

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("fetchJson", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the parsed JSON body on a plain 200", async () => {
    globalThis.fetch = (async () => fakeResponse(200, { hello: "world" })) as typeof fetch;
    const result = await fetchJson<{ hello: string }>("https://example.test/ok");
    assert.deepEqual(result, { hello: "world" });
  });

  it("throws SourceFetchError (non-retryable) on a plain 404, without retrying", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return fakeResponse(404, { error: "not found" });
    }) as typeof fetch;
    await assert.rejects(() => fetchJson("https://example.test/missing"), SourceFetchError);
    assert.equal(calls, 1, "a 404 must not be retried: retrying can't fix a not-found");
  });

  it("retries a 503 with backoff and succeeds once the server recovers", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) return fakeResponse(503, {});
      return fakeResponse(200, { ok: true });
    }) as typeof fetch;
    const result = await fetchJson<{ ok: boolean }>("https://example.test/flaky", { maxAttempts: 3 });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3);
  });

  it("gives up after maxAttempts on a persistent 503", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return fakeResponse(503, {});
    }) as typeof fetch;
    await assert.rejects(() => fetchJson("https://example.test/down", { maxAttempts: 2 }), SourceFetchError);
    assert.equal(calls, 2);
  });

  it("honors a numeric Retry-After header on a 429 instead of the default backoff", async () => {
    let calls = 0;
    const timestamps: number[] = [];
    globalThis.fetch = (async () => {
      timestamps.push(Date.now());
      calls++;
      if (calls === 1) return fakeResponse(429, {}, { "retry-after": "0" });
      return fakeResponse(200, { ok: true });
    }) as typeof fetch;
    const result = await fetchJson<{ ok: boolean }>("https://example.test/rate-limited", { maxAttempts: 2 });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  });

  it("rejects a response whose Content-Length exceeds the size safeguard, without reading the body", async () => {
    let bodyRead = false;
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-length": String(1024 * 1024 * 1024) }),
        text: async () => {
          bodyRead = true;
          return "{}";
        },
      } as Response;
    }) as typeof fetch;
    await assert.rejects(
      () => fetchJson("https://example.test/huge", { maxResponseBytes: 1024 }),
      SourceFetchError,
    );
    assert.equal(bodyRead, false, "an oversized response should be rejected by its Content-Length header alone");
  });

  it("throws a clear SourceFetchError on malformed (non-JSON) response bodies", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: async () => "<html>not json</html>",
      } as Response;
    }) as typeof fetch;
    await assert.rejects(() => fetchJson("https://example.test/malformed"), /not valid JSON/);
  });

  it("times out and throws when a request hangs past timeoutMs", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;
    await assert.rejects(
      () => fetchJson("https://example.test/slow", { timeoutMs: 50, maxAttempts: 1 }),
      /timed out/,
    );
  });
});
