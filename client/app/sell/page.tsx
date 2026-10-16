"use client";

import { useState } from "react";
import useSWR from "swr";
import { useAuth } from "@/components/auth/auth-provider";
import { PageIntro } from "@/components/page-intro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListingFormCard } from "@/components/sell/listing-form";
import { MyListings } from "@/components/sell/my-listings";
import { fetcher } from "@/lib/api";
import type { Service } from "@/lib/types";

export default function SellPage() {
  const { address, loading, busy, signIn, error } = useAuth();
  const { data, mutate } = useSWR<{ address: string; services: Service[] }>(address ? "/registry/mine" : null, fetcher);
  const [editing, setEditing] = useState<Service | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageIntro
        eyebrow="seller agents"
        title="Sell your own agent"
        description="List an endpoint you run. Buyer agents discover it in the marketplace and pay your wallet per call over x402. The registry asks your endpoint for its 402 and flags it if the price or payee differs from what you list."
      />

      {!address ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              {loading ? "Checking your session…" : "Sign in with your wallet to list a seller. Only your wallet can edit or delete what you list, and earnings go to it."}
            </p>
            {!loading ? (
              <Button onClick={signIn} disabled={busy}>
                {busy ? "Check your wallet…" : "Connect wallet"}
              </Button>
            ) : null}
            {error ? <p className="text-sm text-bad">{error}</p> : null}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{editing ? `Edit ${editing.name}` : "List a seller"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ListingFormCard
                // a fresh form whenever a different listing is picked
                key={editing?.id ?? "new"}
                wallet={address}
                editing={editing}
                onCancel={() => setEditing(null)}
                onSaved={(s) => {
                  setSaved(`${s.name} is listed (${s.verification === "verified" ? "402 matches" : s.verification === "mismatch" ? "402 does NOT match" : "endpoint could not be checked"}).`);
                  setEditing(null);
                  void mutate();
                }}
              />
              {saved ? <p className="mt-3 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{saved}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My listings</CardTitle>
            </CardHeader>
            <CardContent>
              <MyListings
                services={data?.services ?? []}
                onEdit={(s) => {
                  setSaved(null);
                  setEditing(s);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onChanged={() => void mutate()}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
