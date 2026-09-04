// The barely-there hairline squares behind the black sections. Deliberately
// very low contrast: this is texture, not pattern -- if you notice it as a
// grid it's too strong. A deterministic xorshift rather than Math.random so
// server and client render identical markup (hydration) and the layout
// doesn't reshuffle between renders.
function cells(seed: number, count: number, cols: number, rows: number) {
  let s = seed;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return Math.abs(s);
  };

  const taken = new Set<string>();
  const out: { x: number; y: number; size: number; alpha: number }[] = [];
  for (let i = 0; i < count; i++) {
    const size = 1 + (next() % 3 === 0 ? 1 : 0); // mostly 1x1, occasionally 2x2
    const x = next() % cols;
    const y = next() % rows;
    const key = `${x}:${y}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ x, y, size, alpha: 0.035 + (next() % 40) / 1000 });
  }
  return out;
}

const UNIT = 52;

export default function PixelGrid({
  seed = 7,
  count = 14,
  cols = 7,
  rows = 6,
  className = "",
}: {
  seed?: number;
  count?: number;
  cols?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`}>
      <div className="relative" style={{ width: cols * UNIT, height: rows * UNIT }}>
        {cells(seed, count, cols, rows).map((c, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: c.x * UNIT,
              top: c.y * UNIT,
              width: c.size * UNIT,
              height: c.size * UNIT,
              border: `1px solid rgba(255,255,255,${c.alpha})`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
