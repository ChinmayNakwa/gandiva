import Link from "next/link";
import { LogoLockup } from "./logo";
import { NAV_ITEMS } from "@/lib/nav";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <LogoLockup />
          <p className="text-xs text-muted-foreground">
            Agents hire agents and pay per call in USDC over x402 v2 on Base Sepolia.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
          <a
            href="https://sepolia.basescan.org"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Explorer
          </a>
        </nav>
      </div>
    </footer>
  );
}
