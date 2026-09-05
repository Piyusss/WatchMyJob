// Serves a company's logo at the best resolution available, and turns a
// missing logo into an honest 404.
//
// Two things this exists to fix.
//
// 1. Neither favicon provider is reliably the sharper one. Measured across
//    all 98 domains in the allowlist, Google's service returned a bigger
//    bitmap for 63, an identical one for 29, and a SMALLER one for 6
//    (meesho.io 256 vs 1080, connectwise.com 256 vs 512, affirm.com 64 vs
//    256). Picking either as "the" provider therefore ships blurry logos
//    for a chunk of the list, so both are asked and the larger bitmap wins.
//
// 2. Both answer an unknown domain with HTTP 404 carrying a valid
//    placeholder image (DuckDuckGo a grey square, Google a globe).
//    Browsers render an image served with a 404 whenever the bytes decode,
//    firing `load` instead of `error`, so <img onError> never ran and every
//    made-up domain showed a placeholder instead of falling back to its own
//    mark. Anything short of a genuine 200 becomes an empty 404 here, which
//    does fire onError.
//
// Proxying also keeps the browser off two third-party hosts on every page
// that lists companies.
const PROVIDERS: ((domain: string) => string)[] = [
  (d) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=256`,
  (d) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`,
];

// Hostname shape only: letter/digit-bounded labels and a real TLD. No
// scheme, port, path, query or userinfo can pass. This value is
// interpolated into the provider URLs, so nothing that could steer those
// requests to another host is allowed through.
const DOMAIN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;

const DAY = 86_400;

// Width in pixels, or 0 when the format isn't one we can measure. Only used
// to rank two candidates against each other, so an unmeasurable-but-valid
// image still wins over nothing at all (see the `?? 1` below).
function pixelWidth(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: IHDR width is a big-endian uint32 at offset 16.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return view.getUint32(16);
  }

  // ICO: a directory of images. Byte 0 of each 16-byte entry is that
  // image's width, with 0 meaning 256. Take the largest, since that is what
  // the browser will pick too.
  if (bytes.length >= 8 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) {
    const count = view.getUint16(4, true);
    let best = 0;
    for (let i = 0; i < count; i++) {
      const offset = 6 + i * 16;
      if (offset >= bytes.length) break;
      const w = bytes[offset] === 0 ? 256 : bytes[offset];
      if (w > best) best = w;
    }
    return best;
  }

  // JPEG: width lives in the SOF marker's payload.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return view.getUint16(i + 7);
      }
      i += 2 + view.getUint16(i + 2);
    }
  }

  return 0;
}

type Candidate = { bytes: Uint8Array; contentType: string; width: number };

async function fetchCandidate(url: string): Promise<Candidate | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    return {
      bytes,
      contentType: res.headers.get("content-type") ?? "image/x-icon",
      width: pixelWidth(bytes) || 1,
    };
  } catch {
    return null;
  }
}

function missing(maxAgeSeconds: number): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": `public, max-age=${maxAgeSeconds}` },
  });
}

export async function GET(request: Request): Promise<Response> {
  const domain = new URL(request.url).searchParams.get("domain")?.trim().toLowerCase();

  // A malformed or absent domain is a permanent miss, not an error: the
  // caller renders its own mark either way.
  if (!domain || !DOMAIN.test(domain)) return missing(DAY);

  // In parallel, so the slower provider sets the latency rather than the
  // two of them adding up.
  const candidates = (await Promise.all(PROVIDERS.map((url) => fetchCandidate(url(domain))))).filter(
    (c): c is Candidate => c !== null,
  );

  if (candidates.length === 0) return missing(DAY);

  const best = candidates.reduce((a, b) => (b.width > a.width ? b : a));

  return new Response(best.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": best.contentType,
      "Cache-Control": `public, max-age=${DAY}`,
    },
  });
}
