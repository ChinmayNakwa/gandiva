"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightIcon, MenuIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/lib/nav";
import { fadeUp, stagger, transition } from "@/lib/motion";
import { LogoLockup } from "./logo";

const list = stagger(0.05, 0.08);

/** Phone navigation: a full-screen sheet with the pages set large in the serif. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <MenuIcon />
        </Button>
      </Dialog.Trigger>

      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            {/* Radix locks page scrolling from the overlay, so it must render
                even though the sheet itself covers the screen. */}
            <Dialog.Overlay forceMount className="fixed inset-0 z-60" />
            <Dialog.Content forceMount asChild aria-describedby={undefined}>
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={transition.base}
                className="fixed inset-0 z-60 flex flex-col bg-background"
              >
                <Dialog.Title className="sr-only">Menu</Dialog.Title>
                <div className="flex h-14 items-center justify-between border-b border-border/70 px-4">
                  <Link href="/" onClick={close}>
                    <LogoLockup />
                  </Link>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close menu">
                      <XIcon />
                    </Button>
                  </Dialog.Close>
                </div>

                <motion.nav
                  variants={list}
                  initial="hidden"
                  animate="show"
                  className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-6"
                >
                  {NAV_ITEMS.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <motion.div key={item.href} variants={fadeUp}>
                        <Link
                          href={item.href}
                          onClick={close}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center justify-between border-b border-border/60 py-4 font-display text-4xl",
                            active ? "text-primary" : "text-foreground",
                          )}
                        >
                          {item.label}
                          <ArrowRightIcon className="size-5 opacity-50" />
                        </Link>
                      </motion.div>
                    );
                  })}
                </motion.nav>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
