"use client";

import { useInfo } from "@/lib/hooks";
import { explorerAddress, short } from "@/lib/format";

export function InfoBar() {
  const { data: info, error } = useInfo();

  if (error) {
    return <span className="text-bad">API unreachable</span>;
  }
  if (!info) return <span>loading…</span>;

  return (
    <>
      <span>
        network <span className="text-foreground">{info.network}</span>
      </span>
      <span>
        USDC{" "}
        <a
          href={explorerAddress(info.asset) ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline-offset-4 hover:underline"
          title={info.asset}
        >
          {short(info.asset)}
        </a>
      </span>
      <span>
        buyer{" "}
        {info.buyer ? (
          <a
            href={`${explorerAddress(info.buyer)}#tokentxns`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
            title={info.buyer}
          >
            {short(info.buyer)}
          </a>
        ) : (
          <span className="text-warn">not configured</span>
        )}
      </span>
      <span>
        LLM <span className="text-foreground">{info.llm.model}</span>{" "}
        {info.llm.available ? (
          <span className="text-ok">online</span>
        ) : (
          <span className="text-warn">offline</span>
        )}
      </span>
    </>
  );
}
