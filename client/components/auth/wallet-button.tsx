"use client";

import { Button } from "@/components/ui/button";
import { short } from "@/lib/format";
import { useAuth } from "./auth-provider";

export function WalletButton() {
  const { address, loading, busy, error, signIn, signOut } = useAuth();

  if (loading) return <Button variant="outline" size="sm" disabled>…</Button>;

  if (address) {
    return (
      <div className="flex items-center gap-1">
        <span className="hidden rounded-md bg-muted px-2 py-1 font-mono text-xs sm:inline" title={address}>
          {short(address)}
        </span>
        <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span className="max-w-40 truncate text-xs text-bad sm:max-w-72" title={error}>
          {error}
        </span>
      ) : null}
      <Button size="sm" onClick={signIn} disabled={busy}>
        {busy ? "Check your wallet…" : "Connect wallet"}
      </Button>
    </div>
  );
}
