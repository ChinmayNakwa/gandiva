"use client";

import { useState } from "react";

/**
 * Tells which rows arrived after the first load, so only those flash in.
 * Pass `undefined` until the first load has finished. Ids must grow over time
 * (ledger and sales ids do).
 */
export function useFreshIds(ids: number[] | undefined) {
  const [baseline, setBaseline] = useState<number | null>(null);
  if (baseline === null && ids) setBaseline(ids.length ? Math.max(...ids) : 0);
  return (id: number) => baseline !== null && id > baseline;
}
