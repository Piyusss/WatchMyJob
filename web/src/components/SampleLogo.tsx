import { avatarColors } from "@/lib/avatar";

// Four generic abstract marks shown in place of a real logo for a company
// that has no domain on file: in practice, a test company created from
// the admin tab without one (see CompanyLogo.tsx). Without this, that
// company rendered as a bare initial everywhere, which stood out obviously
// against every real company's actual logo. Colored via avatarColors, the
// same deterministic palette the initials fallback already uses, so a given
// company always gets the same mark/color pair rather than a new one on
// every render.
const MARKS: ((props: { color: string }) => React.ReactElement)[] = [
  ({ color }) => (
    <svg viewBox="0 0 24 24" fill="none" className="size-full">
      <circle cx="9" cy="12" r="6" stroke={color} strokeWidth="2" />
      <circle cx="15" cy="12" r="6" stroke={color} strokeWidth="2" />
    </svg>
  ),
  ({ color }) => (
    <svg viewBox="0 0 24 24" fill="none" className="size-full">
      <path d="M4 17 L9 8 L13 14 L16 9 L20 17 Z" fill={color} />
    </svg>
  ),
  ({ color }) => (
    <svg viewBox="0 0 24 24" fill="none" className="size-full">
      <path d="M12 3 L19 7.5 V16.5 L12 21 L5 16.5 V7.5 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.2" fill={color} />
    </svg>
  ),
  ({ color }) => (
    <svg viewBox="0 0 24 24" fill="none" className="size-full">
      <path d="M12 3 L14 10 L21 12 L14 14 L12 21 L10 14 L3 12 L10 10 Z" fill={color} />
    </svg>
  ),
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export default function SampleLogo({ name }: { name: string }) {
  const { fg } = avatarColors(name);
  // A different string than avatarColors hashes, so the mark and the color
  // don't move in lockstep for names that happen to share a hash modulo.
  const Mark = MARKS[hash(`${name}-mark`) % MARKS.length];
  // A solid tile with a white glyph, rather than a thin outline on white:
  // real favicons are filled squares, so an outline sitting next to them
  // read as an empty box rather than as a logo. Padding is a percentage so
  // the glyph keeps its proportions at every size this is rendered at (32
  // through 48 across the app). Every fg in the palette is dark enough to
  // carry white.
  return (
    <span className="grid size-full place-items-center p-[24%]" style={{ backgroundColor: fg }}>
      <Mark color="#ffffff" />
    </span>
  );
}
