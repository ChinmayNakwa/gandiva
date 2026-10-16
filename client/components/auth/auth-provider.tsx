"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { signInWithWallet, signOut as apiSignOut, walletErrorMessage } from "@/lib/wallet";

interface AuthState {
  /** Lower-case wallet address of the signed-in user, or null for a visitor. */
  address: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<{ address: string | null }>("/auth/me", fetcher, { revalidateOnFocus: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const address = await signInWithWallet();
      await mutate({ address }, { revalidate: false });
    } catch (err) {
      setError(walletErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [mutate]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await apiSignOut();
      await mutate({ address: null }, { revalidate: false });
    } finally {
      setBusy(false);
    }
  }, [mutate]);

  const value = useMemo<AuthState>(
    () => ({ address: data?.address ?? null, loading: isLoading, busy, error, signIn, signOut }),
    [data, isLoading, busy, error, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
