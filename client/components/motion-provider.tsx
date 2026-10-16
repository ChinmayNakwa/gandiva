"use client";

import { MotionConfig } from "motion/react";

/**
 * One place for app-wide motion settings. `reducedMotion="user"` makes every
 * motion animation drop transforms (keeping opacity fades) when the OS asks
 * for reduced motion.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
