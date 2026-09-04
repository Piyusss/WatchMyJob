"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const PERSONAS = [
  {
    emoji: "💻",
    name: "Software Engineers",
    body: "Watch the companies you'd actually leave for. JobDrop matches on role family, seniority and years of experience, so a staff-level posting never lands because a number happened to overlap.",
  },
  {
    emoji: "📊",
    name: "Data and ML",
    body: "Data platform, analytics and ML roles are scattered across a dozen boards under a dozen titles. Set the role once and let the matching handle the naming.",
  },
  {
    emoji: "🎨",
    name: "Product Designers",
    body: "Design openings move fast and close quietly. JobDrop tells you the hour one appears, and drops it from your list once the company takes it down.",
  },
  {
    emoji: "🧭",
    name: "Product Managers",
    body: "Filter by level and location so you see PM roles pitched at you, not the entire company's org chart.",
  },
  {
    emoji: "🎓",
    name: "New Grads",
    body: "Internships and new-grad roles only reach you if you ask for them — and when you do, you hear about them before the applicant count climbs.",
  },
] as const;

const ROTATE_MS = 4200;

export default function PersonaSwitcher() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (paused || reduceMotion) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % PERSONAS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, reduceMotion]);

  const current = PERSONAS[active];
  const rest = PERSONAS.map((p, i) => ({ ...p, i })).filter((p) => p.i !== active);

  return (
    <div
      className="grid gap-10 lg:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] lg:gap-16"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <h2 className="text-[2rem] font-bold leading-tight tracking-[-0.03em] text-lp-text sm:text-[2.6rem]">
        JobDrop for
      </h2>

      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={current.name}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-3">
              <span className="text-[1.7rem] leading-none sm:text-[2.1rem]">{current.emoji}</span>
              <h3 className="text-[1.7rem] font-bold leading-tight tracking-[-0.03em] text-lp-text sm:text-[2.2rem]">
                {current.name}
              </h3>
            </div>
            <p className="mt-4 max-w-xl text-[0.95rem] leading-[1.7] text-lp-muted">{current.body}</p>
            <Link
              href="/register"
              className="mt-5 inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-lp-text transition-opacity hover:opacity-70"
            >
              Get started <span aria-hidden>→</span>
            </Link>
          </motion.div>
        </AnimatePresence>

        {/* The personas not currently shown, set in the serif to sit back
            from the active one. Buttons, not decoration -- clicking one
            selects it, and keyboard focus works the same way. */}
        <ul className="mt-10 space-y-2.5">
          {rest.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onClick={() => setActive(p.i)}
                className="group flex items-center gap-3.5 text-left"
              >
                <span className="text-[1.15rem] leading-none opacity-70 transition-opacity group-hover:opacity-100">
                  {p.emoji}
                </span>
                <span className="font-display text-[1.5rem] leading-tight text-lp-faint transition-colors group-hover:text-lp-muted sm:text-[1.8rem]">
                  {p.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
