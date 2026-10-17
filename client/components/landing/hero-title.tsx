"use client";

import { useRef } from "react";
import { useGsap } from "@/lib/gsap";
import { gsapEase } from "@/lib/motion";

// Bow drawing, in px (the SVG is drawn 1:1). The string rests at x=6 and is
// drawn back to x=-8 before release; the arrow's nock sits on the string.
const STRING_REST = "M6 2 L6 32 L6 62";
const STRING_DRAWN = "M6 2 L-8 32 L6 62";
const BOW_STRING_X = 18; // string x inside the SVG box (viewBox starts at -12)
const DRAW_PX = 14;
const CONTENT_MAX = 1152; // max-w-6xl
const MIN_GUTTER_FOR_BOW = 80;
const ARROW_DELAY = 0.55; // s after the line reveal starts
const LINE = "block animate-line-rise motion-reduce:animate-none";

/**
 * The hero headline. Lines rise out of a mask (CSS, from the first paint: this
 * is the page's largest paint, so it must not wait for scripts), then a bow in
 * the left gutter looses an arrow (GSAP) that flies across the page and lands
 * as the underline beneath "per call". Reduced motion: everything shows in its
 * end state.
 */
export function HeroTitle() {
  const root = useRef<HTMLDivElement>(null);

  useGsap(root, ({ gsap, reduced }) => {
    const box = root.current!;
    const h1 = box.querySelector<HTMLElement>("h1")!;
    const overlay = box.querySelector<HTMLElement>("[data-arrow]")!;
    const trail = overlay.querySelector<HTMLElement>("[data-arrow-trail]")!;
    const line = overlay.querySelector<HTMLElement>("[data-arrow-line]")!;
    const head = overlay.querySelector<SVGElement>("[data-arrow-head]")!;
    const bow = overlay.querySelector<SVGElement>("[data-arrow-bow]")!;
    const string = bow.querySelector("[data-bow-string]")!;
    let trailLen = 0;

    // Pin the overlay under "per call". Re-run whenever the text re-flows.
    // Layout offsets, not getBoundingClientRect, so the measurement ignores the
    // lines' rise-in transform.
    function place() {
      const em = h1.querySelector<HTMLElement>("em");
      if (!em) return;
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = em; n && n !== box; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const fs = parseFloat(getComputedStyle(h1).fontSize);
      const emLeft = box.getBoundingClientRect().left + x; // in the viewport
      const gutter = (innerWidth - CONTENT_MAX) / 2;
      const hasBow = gutter >= MIN_GUTTER_FOR_BOW;
      const startX = hasBow ? gutter - 48 : -24;
      const width = Math.max(0, em.offsetWidth - fs * 0.04);
      trailLen = emLeft + width - startX;
      Object.assign(overlay.style, {
        left: `${x}px`,
        top: `${y + em.offsetHeight - fs * 0.05}px`, // just under the descenders
        width: `${width}px`,
      });
      trail.style.width = `${trailLen}px`;
      bow.style.left = `${startX - emLeft - BOW_STRING_X}px`;
      bow.style.display = hasBow ? "" : "none";
    }

    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);

    gsap.set(overlay, { autoAlpha: 1 });
    if (reduced) {
      gsap.set([line, head], { autoAlpha: 1 });
      gsap.set([trail, bow], { autoAlpha: 0 });
      return () => ro.disconnect();
    }

    // The bow rises 0.55s into the line reveal. GSAP loads after the reveal has
    // started (on a slow phone, maybe after it ended), so count from when it began.
    const reveal = h1.getAnimations({ subtree: true })[0];
    const now = Number(document.timeline.currentTime ?? 0);
    const elapsed = reveal?.startTime != null ? (now - Number(reveal.startTime)) / 1000 : 0;

    gsap.set([trail, line, head, bow], { autoAlpha: 0 });
    gsap.set(trail, { scaleX: 0, transformOrigin: "0% 50%" });
    gsap.set(head, { transformOrigin: "0% 50%" });

    const fly = { duration: 0.5, ease: "power1.in" };
    gsap
      .timeline({ delay: Math.max(0, ARROW_DELAY - elapsed) })
      // Raise the bow and draw the string, pulling the arrow back with it.
      .fromTo(bow, { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.35 })
      .set(head, { autoAlpha: 1, x: () => -trailLen }, "<")
      .to(string, { attr: { d: STRING_DRAWN }, duration: 0.4, ease: "power2.out" }, "<0.15")
      .to(head, { x: () => -trailLen - DRAW_PX, duration: 0.4, ease: "power2.out" }, "<")
      // Loose: the string snaps back and the arrow flies to the headline.
      .addLabel("loose", "+=0.08")
      .to(string, { attr: { d: STRING_REST }, duration: 0.7, ease: "elastic.out(1.1, 0.25)" }, "loose")
      .set(trail, { autoAlpha: 1 }, "loose")
      .to(trail, { scaleX: 1, ...fly }, "loose")
      .to(head, { x: 0, ...fly }, "loose")
      // Hit: the arrow quivers, the trail fades and leaves the underline.
      .addLabel("hit")
      .set(line, { autoAlpha: 1 }, "hit")
      .to(head, { keyframes: { rotate: [-9, 6, -3, 1.5, 0] }, duration: 0.5, ease: "none" }, "hit")
      .to(trail, { autoAlpha: 0, duration: 0.7, ease: gsapEase.inOut }, "hit")
      .to(bow, { autoAlpha: 0, x: -10, duration: 0.5, ease: gsapEase.inOut }, "hit+=0.25");

    return () => ro.disconnect();
  });

  return (
    <div ref={root} className="relative mt-6">
      <h1
        data-hero-title
        className="font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl"
      >
        <span className="line-mask block overflow-hidden">
          <span className={LINE} style={{ animationDelay: "0.1s" }}>
            The agent economy,
          </span>
        </span>
        <span className="line-mask block overflow-hidden">
          <span className={LINE} style={{ animationDelay: "0.22s" }}>
            settled <em className="whitespace-nowrap text-primary">per call</em>.
          </span>
        </span>
      </h1>

      <div
        aria-hidden
        data-arrow
        className="pointer-events-none invisible absolute h-0.75 text-primary"
      >
        <span
          data-arrow-trail
          className="absolute top-0 right-0 h-full rounded-full bg-[linear-gradient(to_right,transparent,var(--primary)_55%)]"
        />
        <span data-arrow-line className="absolute inset-0 rounded-full bg-primary" />
        <svg
          data-arrow-head
          viewBox="0 0 14 14"
          className="absolute top-1/2 -right-2 -mt-1.75 size-3.5 overflow-visible"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 2 L12 7 L3 12" />
        </svg>
        <svg
          data-arrow-bow
          viewBox="-12 0 36 64"
          className="absolute top-1/2 -mt-8 h-16 w-9 overflow-visible text-foreground/70"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 2 C 26 16, 26 48, 6 62" strokeWidth={2.4} />
          <path data-bow-string d={STRING_REST} strokeWidth={1} />
        </svg>
      </div>
    </div>
  );
}
