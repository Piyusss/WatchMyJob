// Builds the company logo pack: one sharp 192px PNG per company in
// server/companies.json, saved to web/public/logos/companies/<domain>.png,
// plus web/src/lib/companyLogos.ts listing the domains that have one.
// CompanyLogo shows those files first, and only falls back to the favicon
// proxy (web/src/app/api/company-logo) for domains without one.
//
//   npm run logos                      every company
//   npm run logos -- grafana.com       just these
//
// Re-run after adding companies. Why it exists: favicon services return
// whatever a site's favicon is, often 16-48px, which looks blurry at the
// 48px the companies page shows (96px on a high-resolution screen). Most
// sites also publish bigger icons for phones and app installs: an Apple
// touch icon (usually 180px), web app manifest icons (192-512px), an SVG
// favicon. This finds them all, keeps the sharpest, and stores it resized,
// so the page never downloads a 512px icon to show it at 48.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// One image at a time, without libvips's cache: see candidates().
sharp.concurrency(1);
sharp.cache(false);

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = path.join(ROOT, "web/public/logos/companies");
const LIST_FILE = path.join(ROOT, "web/src/lib/companyLogos.ts");
const SIZE = 192;
// Below this, an icon is still blurry at 48px on a 2x screen, so a
// vector or a bigger raster beats it.
const SHARP_ENOUGH = 160;
// Some sites block requests that don't look like a browser.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
};

async function fetchOk(url, timeoutMs = 15_000) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4]) : undefined;
}

// Every icon the site points at: <link rel="...icon..."> on its homepage,
// its web app manifest's icons, and the conventional Apple touch icon path.
// (mask-icon is skipped: it's Safari's one-colour pinned-tab silhouette.)
async function siteIconUrls(domain) {
  const urls = [];
  for (const origin of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const res = await fetchOk(origin);
      const html = await res.text();
      const base = res.url;
      for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
        const rel = (attribute(tag, "rel") ?? "").toLowerCase();
        const href = attribute(tag, "href");
        if (!href || rel.includes("mask-icon")) continue;
        if (rel.includes("icon")) urls.push(new URL(href.replaceAll("&amp;", "&"), base).href);
        if (rel === "manifest") {
          try {
            const manifestUrl = new URL(href, base).href;
            const manifest = await (await fetchOk(manifestUrl)).json();
            for (const icon of manifest.icons ?? []) {
              if (icon.src) urls.push(new URL(icon.src, manifestUrl).href);
            }
          } catch {
            // A broken manifest just means fewer candidates.
          }
        }
      }
      break;
    } catch {
      // Try the www. host next.
    }
  }
  // The conventional paths, which some sites serve without linking to them,
  // and which still work on a site whose homepage refuses scripts.
  for (const file of CONVENTIONAL_PATHS) urls.push(`https://${domain}/${file}`, `https://www.${domain}/${file}`);
  return urls;
}

// Sites that publish no icon bigger than about 100px, even counting their
// .ico files, or only a wordmark (material.security): their official GitHub
// organization's avatar instead (256px, uploaded by the company), each
// checked by eye on 2026-10-24. If one ever fails to download, the site's
// own icons are used as for everyone else.
const OVERRIDES = Object.fromEntries(
  Object.entries({
    "asana.com": "Asana",
    "cloudflare.com": "cloudflare",
    "cultureamp.com": "cultureamp",
    "dropbox.com": "dropbox",
    "fastly.com": "fastly",
    "gusto.com": "Gusto",
    "intercom.com": "intercom",
    "justworks.com": "justworkshr",
    "launchdarkly.com": "launchdarkly",
    "lumalabs.ai": "lumalabs",
    "material.security": "material-security",
    "mongodb.com": "mongodb",
    "okta.com": "okta",
    "pinecone.io": "pinecone-io",
    "pingidentity.com": "pingidentity",
    "solarwinds.com": "solarwinds",
    "sophos.com": "sophos",
    "toasttab.com": "toasttab",
    "wrike.com": "wrike",
  }).map(([domain, org]) => [domain, `https://github.com/${org}.png?size=256`]),
);

const CONVENTIONAL_PATHS = [
  "apple-touch-icon.png",
  "apple-touch-icon-precomposed.png",
  "android-chrome-512x512.png",
  "android-chrome-192x192.png",
  "favicon.svg",
  "icon.svg",
  "favicon.ico",
];

// An .ico file is a small directory of images, which sharp can't open. The
// largest entry is pulled out: a PNG as it is, a 32-bit bitmap decoded by
// hand (rows stored bottom-up, BGRA, with the height doubled for the mask).
async function fromIco(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  let largest = null;
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > bytes.length) break;
    const width = bytes[entry] || 256;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (offset + size <= bytes.length && (!largest || width > largest.width)) {
      largest = { width, data: bytes.subarray(offset, offset + size) };
    }
  }
  if (!largest) return null;
  const data = largest.data;
  if (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return data; // PNG
  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  const height = data.readInt32LE(8) / 2;
  if (data.readUInt16LE(14) !== 32 || width <= 0 || height <= 0) return null;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = headerSize + ((height - 1 - y) * width + x) * 4;
      const to = (y * width + x) * 4;
      if (from + 4 > data.length) return null;
      rgba[to] = data[from + 2];
      rgba[to + 1] = data[from + 1];
      rgba[to + 2] = data[from];
      rgba[to + 3] = data[from + 3];
    }
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function download(url) {
  try {
    const bytes = Buffer.from(await (await fetchOk(url, 10_000)).arrayBuffer());
    return bytes.length > 0 && bytes.length <= 5_000_000 ? { url, bytes } : null;
  } catch {
    return null;
  }
}

// Measures one download. sharp reads PNG, JPEG, WebP, GIF and SVG, and
// fromIco covers .ico; anything else (an HTML error page) is skipped.
async function measure({ url, bytes }) {
  try {
    bytes = (await fromIco(bytes)) ?? bytes;
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    const vector = meta.format === "svg";
    // An icon is about square; a wide image is a wordmark, unreadable
    // squeezed into the square logo slot.
    const square = Math.max(meta.width, meta.height) / Math.min(meta.width, meta.height) <= 1.25;
    return { url, bytes, vector, square, size: vector ? Infinity : Math.min(meta.width, meta.height) };
  } catch {
    return null;
  }
}

// Downloads in parallel, measures one at a time: sharp crashed the whole
// process now and then with dozens of images open at once.
async function candidates(urls) {
  const found = [];
  for (const downloaded of (await Promise.all(urls.map(download))).filter(Boolean)) {
    const measured = await measure(downloaded);
    if (measured) found.push(measured);
  }
  return found;
}

// Square icons only, when there are any. Among them, a raster that's big
// enough wins (designed for that size, unlike a favicon SVG often drawn for
// 16px), then a vector, then the biggest left.
function best(all) {
  const candidates = all.some((c) => c.square) ? all.filter((c) => c.square) : all;
  const big = candidates.filter((c) => !c.vector && c.size >= SHARP_ENOUGH);
  if (big.length) return big.reduce((a, b) => (b.size > a.size ? b : a));
  const vector = candidates.find((c) => c.vector);
  if (vector) return vector;
  return candidates.reduce((a, b) => (b.size > a.size ? b : a), candidates[0]);
}

async function logoFor(domain) {
  let pick = OVERRIDES[domain] ? (await candidates([OVERRIDES[domain]]))[0] : null;
  if (!pick) {
    const urls = [...new Set([...(await siteIconUrls(domain)), `https://www.google.com/s2/favicons?domain=${domain}&sz=256`])];
    const found = await candidates(urls);
    if (!found.length) return null;
    pick = best(found);
  }
  // Square, transparent padding for a non-square icon, never enlarged: a
  // small icon stays small rather than being blurred up to 192.
  const png = await sharp(pick.bytes, { density: 300 })
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: !pick.vector })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT_DIR, `${domain}.png`), png);
  return pick;
}

async function inParallel(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]);
      }
    }),
  );
  return results;
}

const companies = JSON.parse(await readFile(path.join(ROOT, "server/companies.json"), "utf8"));
const allDomains = [...new Set(companies.map((c) => c.domain).filter(Boolean))].sort();
// Domains given on the command line refresh just those logos.
const domains = process.argv.length > 2 ? process.argv.slice(2) : allDomains;
await mkdir(OUT_DIR, { recursive: true });

const picks = await inParallel(domains, 4, async (domain) => {
  const pick = await logoFor(domain);
  const label = !pick ? "none found" : pick.vector ? "SVG" : `${pick.size}px`;
  console.log(`${domain.padEnd(28)} ${label.padEnd(10)} ${pick ? pick.url.slice(0, 100) : ""}`);
  return pick;
});

const sharpOnes = domains.filter((_, i) => picks[i] && (picks[i].vector || picks[i].size >= SHARP_ENOUGH));
const blurryOnes = domains.filter((_, i) => picks[i] && !picks[i].vector && picks[i].size < SHARP_ENOUGH);
// Every company with a file, including ones from earlier runs.
const present = new Set(await readdir(OUT_DIR));
const listed = allDomains.filter((d) => present.has(`${d}.png`));
await writeFile(
  LIST_FILE,
  `// Generated by scripts/company-logos.mjs: the domains with a logo in
// public/logos/companies/<domain>.png. Re-run it after adding companies.
export const COMPANY_LOGOS: ReadonlySet<string> = new Set([
${listed.map((d) => `  "${d}",`).join("\n")}
]);
`,
);

const notFound = domains.filter((_, i) => !picks[i]);
console.log(`\n${sharpOnes.length} sharp, ${blurryOnes.length} still under ${SHARP_ENOUGH}px, ${notFound.length} with nothing found.`);
if (blurryOnes.length) console.log(`Still small: ${blurryOnes.join(", ")}`);
