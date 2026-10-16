import type Lenis from "lenis";

/**
 * The one Lenis instance (or null when smooth scroll is off: reduced motion,
 * server render, or before it has loaded). Scroll listeners registered here,
 * such as GSAP's ScrollTrigger.update, are attached to whichever instance is
 * current, so the load order of Lenis and GSAP doesn't matter.
 */
let current: Lenis | null = null;
const listeners = new Set<() => void>();
const detach = new Map<() => void, () => void>();

export function getLenis() {
  return current;
}

export function setLenis(lenis: Lenis | null) {
  for (const off of detach.values()) off();
  detach.clear();
  current = lenis;
  if (lenis) for (const fn of listeners) detach.set(fn, lenis.on("scroll", fn));
}

export function onLenisScroll(fn: () => void) {
  listeners.add(fn);
  if (current) detach.set(fn, current.on("scroll", fn));
  return () => {
    listeners.delete(fn);
    detach.get(fn)?.();
    detach.delete(fn);
  };
}
