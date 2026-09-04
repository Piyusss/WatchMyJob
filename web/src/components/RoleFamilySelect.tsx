"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { getRoleFamilyOptions } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_OPTIONS = 60;

// A searchable, options-only select for Role -- classification produces
// thousands of near-title-granular role families (see the server's
// jobs/routes.ts /role-families comment), too many for a plain <Select>'s
// fixed list to be usable, and far too many to invent a coarser fixed
// taxonomy for without changing what "matches" means across the whole app.
// The option list is exactly what's on a real active job right now; there
// is no way to submit a value that isn't in it, satisfying "no arbitrary
// custom values" without a heavier combobox dependency.
export default function RoleFamilySelect({
  value,
  onChange,
  placeholder = "Any role",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const [options, setOptions] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getRoleFamilyOptions()
      .then((res) => setOptions(res.roleFamilies))
      .catch(() => setError(true));
  }, []);

  const filtered = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return matches.slice(0, MAX_VISIBLE_OPTIONS);
  }, [options, query]);

  if (error) {
    return <p className="text-[0.83rem] text-danger">Couldn&apos;t load the list of roles. Please try again.</p>;
  }

  if (!options) {
    return <Skeleton className="h-8 w-full" />;
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
        <Input
          className="bg-surface pl-8 pr-8"
          placeholder={placeholder}
          value={open ? query : (value ?? "")}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setOpen(false)}
          role="combobox"
          aria-expanded={open}
          aria-label="Role"
        />
        {value && !open && (
          <button
            type="button"
            // onMouseDown, not onClick: fires before the input's onBlur, so
            // clearing works even though the dropdown isn't open right now.
            onMouseDown={(e) => {
              e.preventDefault();
              onChange(null);
            }}
            aria-label="Clear role"
            className="absolute right-2 top-1/2 grid size-4.5 -translate-y-1/2 place-items-center rounded-full text-ink-faint hover:bg-tint-strong hover:text-ink"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-md">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[0.83rem] text-ink-muted">No matching roles</li>
          ) : (
            filtered.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  // onMouseDown fires before the input's onBlur closes the
                  // list -- onClick here would never run.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full truncate px-3 py-1.5 text-left text-[0.85rem] text-ink-secondary hover:bg-tint",
                    option === value && "bg-brand-tint text-brand-ink",
                  )}
                >
                  {option}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
