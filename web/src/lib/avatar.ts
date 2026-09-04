// Deterministic per-company avatar colors. Muted, desaturated tones drawn
// to sit on the warm canvas -- a company mark should identify, not shout,
// so these are deliberately low-chroma rather than a bright random palette.
const AVATAR_PALETTE = [
  { bg: "#e3ede9", fg: "#0e6b54" }, // emerald
  { bg: "#e7ecf3", fg: "#2f5680" }, // slate blue
  { bg: "#f3e8e1", fg: "#a05a34" }, // clay
  { bg: "#ece7f1", fg: "#5b4a7d" }, // muted violet
  { bg: "#f2ebdd", fg: "#8a6a26" }, // ochre
  { bg: "#e6efe6", fg: "#3f6b41" }, // moss
  { bg: "#f3e6e6", fg: "#96453f" }, // brick
];

export function avatarColors(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
