"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useMotionValue } from "motion/react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/lib/nav";
import { spring } from "@/lib/motion";
import { InfoBar } from "./info-bar";
import { LogoLockup } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletButton } from "@/components/auth/wallet-button";

/**
 * How far down the page the reader is, 0..1. Re-measured when the page grows
 * or shrinks too (live runs add content), and 0 when there is nothing to scroll.
 */
function useScrollProgress() {
  const progress = useMotionValue(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.set(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [progress]);
  return progress;
}

export function SiteHeader() {
  const pathname = usePathname();
  const scrollYProgress = useScrollProgress();

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80">
          <LogoLockup />
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative isolate rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* One pill that slides to whichever page is active. */}
                {active ? (
                  <motion.span
                    layoutId="nav-pill"
                    transition={spring.soft}
                    className="absolute inset-0 -z-10 rounded-md bg-muted"
                  />
                ) : null}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/marketplace">Open dashboard</Link>
          </Button>
          <ThemeToggle />
          <WalletButton />
          <MobileMenu />
        </div>
      </div>

      <div className="border-t border-border/60">
        {/* One line on phones (scrolls sideways, the fade hints at more) instead of wrapping into a block. */}
        <div className="mx-auto flex w-full max-w-6xl items-center gap-x-4 overflow-x-auto px-4 py-1.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground scrollbar-none mask-r-from-85% md:flex-wrap md:mask-none">
          <InfoBar />
        </div>
      </div>

      {/* Reading progress: a vermilion hairline along the header's bottom edge. */}
      <motion.div
        aria-hidden
        style={{ scaleX: scrollYProgress }}
        className="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-primary"
      />
    </header>
  );
}
