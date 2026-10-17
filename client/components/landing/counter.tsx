"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
import { ease } from "@/lib/motion";

export function Counter({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.2,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Where the number currently stands, so live updates count on from there
  // instead of restarting at 0.
  const shown = useRef(0);
  // Standalone animate() ignores MotionConfig, so check the preference here.
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const format = (v: number) => `${prefix}${v.toFixed(decimals)}${suffix}`;
    if (reduced || shown.current === value) {
      shown.current = value;
      node.textContent = format(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration,
      ease: ease.out,
      onUpdate: (v) => {
        shown.current = v;
        node.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, decimals, prefix, suffix, duration, reduced]);

  return (
    <span ref={ref}>
      {prefix}
      {(0).toFixed(decimals)}
      {suffix}
    </span>
  );
}
