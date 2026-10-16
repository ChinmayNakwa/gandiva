import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hero } from "@/components/landing/hero";
import { X402Flow } from "@/components/landing/x402-flow";
import { LiveFeed } from "@/components/landing/live-feed";
import { Safety } from "@/components/landing/safety";
import { MetricsBand } from "@/components/landing/metrics-band";
import { Reveal } from "@/components/landing/reveal";

export default function Home() {
  return (
    <>
      <Hero />
      <X402Flow />
      <LiveFeed />
      <Safety />
      <MetricsBand />

      <section className="mx-auto w-full max-w-6xl px-4 pb-24">
        <Reveal>
          <div className="flex flex-col items-center gap-5 rounded-3xl border border-primary/20 bg-primary/5 px-6 py-14 text-center">
            <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
              See it settle for yourself
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Browse the registry, launch a buyer run and watch the receipts
              land on Base Sepolia.
            </p>
            <Button asChild size="lg">
              <Link href="/marketplace">
                Open the dashboard <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </>
  );
}
