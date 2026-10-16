"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { stars } from "@/lib/format";
import type { Run } from "@/lib/types";

export function ResultView({ run }: { run: Run }) {
  const result = run.result;
  if (!result) return null;
  const priceKey = `price_${result.currency.toLowerCase()}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 font-mono text-xs text-muted-foreground">
        <span>
          pages scraped:{" "}
          <span className="text-foreground">
            {result.pagesScraped.join(", ") || "none"}
          </span>
        </span>
        <span>
          missing:{" "}
          <span className="text-foreground">
            {result.pagesMissing.join(", ") || "none"}
          </span>
        </span>
        <span>
          fx {result.currency}:{" "}
          <span className="text-foreground">
            {result.fxRate ?? "n/a"} {result.fxDate ? `(${result.fxDate})` : ""}
          </span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {result.books.map((b, i) => (
          <Card key={i} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{b.title}</span>
                <span className="font-mono text-xs text-warn">
                  {stars(b.rating)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs">
              <div className="font-mono">
                £{b.price_gbp} →{" "}
                <span className="text-primary">
                  {String(b[priceKey] ?? "?")} {result.currency}
                </span>
              </div>
              <div className="text-muted-foreground">
                {b.summary_hi ?? "(no summary)"}
              </div>
              <a
                href={b.url}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-[11px] text-primary underline-offset-4 hover:underline"
              >
                {b.url}
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function Explanation({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-card/40 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
      {text}
    </pre>
  );
}
