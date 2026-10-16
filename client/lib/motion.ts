import type { Transition, Variants } from "motion/react";

/**
 * Shared motion vocabulary, so every animation in the app feels like the same
 * hand. motion (React) and GSAP both read from here; CSS gets the same curve as
 * `ease-out-quint` (see globals.css).
 *
 * Rules: animate only transform and opacity; keep UI feedback under 0.35s;
 * reserve the slower values for reveals and signature moments.
 */

export const ease = {
  /** The house curve: fast start, long soft landing. */
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** GSAP names for the same curves. */
export const gsapEase = {
  out: "power4.out",
  inOut: "power2.inOut",
} as const;

/** Seconds. */
export const duration = {
  fast: 0.18,
  base: 0.35,
  slow: 0.55,
  reveal: 0.7,
} as const;

export const spring = {
  /** Icons, toggles, small UI that should feel crisp. */
  snappy: { type: "spring", stiffness: 420, damping: 26 },
  /** Cards, panels, hover lifts. */
  soft: { type: "spring", stiffness: 220, damping: 26 },
  /** Numbers and counters: settles without overshoot. */
  number: { type: "spring", stiffness: 90, damping: 20, mass: 0.8 },
} as const satisfies Record<string, Transition>;

export const transition = {
  base: { duration: duration.base, ease: ease.out },
  slow: { duration: duration.slow, ease: ease.out },
} as const satisfies Record<string, Transition>;

/** Fade up into place. Use with `initial="hidden" animate="show"` or whileInView. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: transition.slow },
};

/** Parent that staggers its children's variants. */
export function stagger(each = 0.08, delay = 0.05): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: each, delayChildren: delay } },
  };
}
