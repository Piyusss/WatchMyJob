// Shared request layer for every source adapter. Centralized so timeout,
// retry, 429/Retry-After, and response-size handling are defined once and
// can't drift per-adapter -- an adapter author only has to think about
// parsing the response body, not how to fetch it safely.

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25MB -- generous enough for a large real board (Databricks: 864+ jobs with full descriptions) while still bounding a runaway/malformed response.
const BASE_BACKOFF_MS = 500;

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

// Retry-After is either a whole number of seconds or an HTTP-date -- both
// are valid per RFC 9110 and real APIs use both.
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchJsonOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
}

// Fetches a URL and returns the parsed JSON body, with: a hard timeout per
// attempt, bounded retries with exponential backoff for retryable failures
// (429/502/503/504 and network errors -- never for other 4xx, which retrying
// can't fix), Retry-After respected when the server sends one, and a
// response-size cap enforced before the body is ever handed to JSON.parse.
// Throws SourceFetchError on any unrecoverable outcome; sync.ts's existing
// per-source try/catch already isolates one source's failure from every
// other source and from the closure/matching logic (see sync.ts's
// syncSource -- the adapter call happens before any diff/closure work).
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        const retryable = isRetryableStatus(res.status);
        if (retryable && attempt < maxAttempts) {
          const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
          await sleep(retryAfterMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        throw new SourceFetchError(`Request to ${url} returned ${res.status} ${res.statusText}`, retryable);
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxResponseBytes) {
        throw new SourceFetchError(
          `Response from ${url} is ${contentLength} bytes, exceeding the ${maxResponseBytes}-byte safeguard`,
          false,
        );
      }

      const text = await res.text();
      if (text.length > maxResponseBytes) {
        throw new SourceFetchError(
          `Response body from ${url} is ${text.length} bytes, exceeding the ${maxResponseBytes}-byte safeguard`,
          false,
        );
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new SourceFetchError(`Response from ${url} was not valid JSON`, false);
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      // A SourceFetchError reaching here was already thrown past the point
      // where a retry was possible (either genuinely non-retryable, or a
      // retryable status that had already exhausted its attempts) -- pass
      // it straight through rather than re-wrapping it.
      if (err instanceof SourceFetchError) throw err;

      // Anything else is a timeout (AbortError) or a network-level failure
      // (DNS, connection reset, ...) -- both worth retrying with backoff,
      // same as a retryable HTTP status.
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt < maxAttempts) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }

      const timeoutSuffix = isAbort ? ` (timed out after ${timeoutMs}ms)` : "";
      throw new SourceFetchError(
        `Request to ${url} failed after ${maxAttempts} attempt(s)${timeoutSuffix}: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    }
  }

  // Unreachable -- the loop above always returns or throws -- but keeps the
  // function's return type honest without a non-null assertion.
  throw lastError instanceof Error ? lastError : new SourceFetchError(`Request to ${url} failed`, false);
}
