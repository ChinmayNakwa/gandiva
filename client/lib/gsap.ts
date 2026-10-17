"use client";

import { useEffect, type DependencyList, type RefObject } from "react";
import { duration, gsapEase } from "@/lib/motion";
import { onLenisScroll } from "@/lib/scroll";

type GsapModule = typeof import("gsap");
export type Gsap = GsapModule["gsap"];
export type ScrollTriggerType = typeof import("gsap/ScrollTrigger").ScrollTrigger;

export type GsapKit = {
  gsap: Gsap;
  ScrollTrigger: ScrollTriggerType;
};

let loading: Promise<GsapKit> | null = null;

/**
 * Load GSAP and ScrollTrigger on first use only, so pages without
 * GSAP animations never download them. Safe to call many times.
 */
export function loadGsap(): Promise<GsapKit> {
  loading ??= Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger"),
  ]).then(([{ gsap }, { ScrollTrigger }]) => {
    gsap.registerPlugin(ScrollTrigger);
    gsap.defaults({ ease: gsapEase.out, duration: duration.slow });
    // Keep scroll-driven animations in step with Lenis smooth scrolling.
    onLenisScroll(ScrollTrigger.update);
    return { gsap, ScrollTrigger };
  });
  return loading;
}

export type GsapSetup = (
  kit: GsapKit & {
    /** True when the OS asks for reduced motion: show the end state, skip the choreography. */
    reduced: boolean;
  },
) => void | (() => void);

/**
 * Run GSAP animations scoped to `scope`. GSAP loads lazily; everything the
 * setup creates (tweens, timelines, ScrollTriggers) is reverted on unmount,
 * and the setup re-runs if the reduced-motion preference changes mid-session.
 * Selector strings inside setup only match elements within `scope`.
 */
export function useGsap(
  scope: RefObject<HTMLElement | null>,
  setup: GsapSetup,
  deps: DependencyList = [],
) {
  useEffect(() => {
    let cancelled = false;
    let mm: ReturnType<Gsap["matchMedia"]> | null = null;

    loadGsap().then((kit) => {
      if (cancelled || !scope.current) return;
      mm = kit.gsap.matchMedia(scope.current);
      mm.add(
        {
          reduced: "(prefers-reduced-motion: reduce)",
          full: "(prefers-reduced-motion: no-preference)",
        },
        (ctx) => setup({ ...kit, reduced: Boolean(ctx.conditions?.reduced) }),
      );
    });

    return () => {
      cancelled = true;
      mm?.revert();
    };
    // `setup` is intentionally excluded: callers pass `deps` for what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
