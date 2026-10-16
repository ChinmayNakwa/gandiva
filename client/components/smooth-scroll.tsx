"use client";

import { useEffect } from "react";
import type Lenis from "lenis";
import "lenis/dist/lenis.css";
import { setLenis } from "@/lib/scroll";

/**
 * Inertial wheel scrolling (Lenis). Off for reduced-motion users, and touch
 * scrolling is always left native. Lenis itself loads lazily after hydration.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;
    let cancelled = false;

    async function start() {
      if (lenis || reduce.matches) return;
      const { default: LenisCtor } = await import("lenis");
      if (cancelled || lenis || reduce.matches) return;
      lenis = new LenisCtor({
        autoRaf: true,
        anchors: true,
        // Let the live log, tables and other inner scrollers scroll themselves.
        allowNestedScroll: true,
        // Stand down while a Radix menu, select or dialog has locked the page,
        // and inside their popups, so their own scrolling works.
        prevent: (node) =>
          document.body.hasAttribute("data-scroll-locked") ||
          node.closest("[data-radix-popper-content-wrapper], [role='dialog']") !== null,
      });
      setLenis(lenis);
    }

    function stop() {
      lenis?.destroy();
      lenis = null;
      setLenis(null);
    }

    const onChange = () => (reduce.matches ? stop() : void start());
    void start();
    reduce.addEventListener("change", onChange);

    return () => {
      cancelled = true;
      reduce.removeEventListener("change", onChange);
      stop();
    };
  }, []);

  return null;
}
