import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/site/logo";

export default function Home() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center">
      <LogoMark className="mb-6 size-12 text-primary" />
      <h1 className="max-w-3xl font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
        Agents hire agents and pay per call
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        A pay-per-call agent economy settling every request in USDC over x402 v2 on Base Sepolia.
      </p>
      <div className="mt-8">
        <Button asChild size="lg">
          <Link href="/marketplace">
            Open the dashboard <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </section>
  );
}
