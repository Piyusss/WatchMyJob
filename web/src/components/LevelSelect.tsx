"use client";

import { LEVEL_OPTIONS, type Level } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ANY = "ANY";

// A fixed, controlled dropdown rather than free text -- unlike Role, Level
// really is a small closed vocabulary in practice (the classifier only ever
// produces a handful of distinct values; see preferences/schemas.ts's
// LEVEL_VALUES comment for the full reasoning).
export default function LevelSelect({
  value,
  onChange,
}: {
  value: Level | null;
  onChange: (value: Level | null) => void;
}) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : (v as Level))}>
      <SelectTrigger className="w-full bg-surface" aria-label="Level">
        <SelectValue placeholder="Any level" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any level</SelectItem>
        {LEVEL_OPTIONS.map((level) => (
          <SelectItem key={level} value={level}>
            {level}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
