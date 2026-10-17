import { Hono, type Context } from "hono";
import { toUnits } from "../config.js";
import { listServices } from "../registry/store.js";
import { listStakeEvents, prepareStake, prepareUnstake, relayStake, relayUnstake, slashedTotal, stakeEnabled, StakeError, stakeInfo, stakeOf, withdrawFor } from "./index.js";

export const stakeRoutes = new Hono();

const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const fail = (c: Context, err: any) =>
  err instanceof StakeError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err?.shortMessage ?? err?.message ?? err).split("\n")[0] }, 400);

/** Contract details plus every listed payTo's bond, so the marketplace can show who has skin in the game. */
stakeRoutes.get("/", async (c) => {
  try {
    const info = await stakeInfo();
    if (!info.enabled) return c.json({ ...info, sellers: [] });
    const payTos = [...new Set(listServices().map((s) => s.payTo.toLowerCase()))];
    const sellers = await Promise.all(
      payTos.map(async (payTo) => {
        const slashed = slashedTotal(payTo);
        return { payTo, ...(await stakeOf(payTo)), slashedCount: slashed.count, slashed: slashed.amount.toString() };
      }),
    );
    return c.json({ ...info, sellers });
  } catch (err) {
    return fail(c, err);
  }
});

stakeRoutes.get("/events", (c) => c.json({ events: listStakeEvents({ seller: c.req.query("seller") }) }));

stakeRoutes.get("/:address", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "address must be a 0x EVM address" }, 400);
  const slashed = slashedTotal(address);
  return c.json({ enabled: stakeEnabled(), address, ...(await stakeOf(address, true)), slashedCount: slashed.count, slashed: slashed.amount.toString() });
});

/** Typed data the seller signs in its wallet (no gas). Body: { seller, amount } with amount in USDC, e.g. "0.05". */
stakeRoutes.post("/prepare", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isAddress(body.seller)) return c.json({ error: "seller must be a 0x EVM address" }, 400);
  if (typeof body.amount !== "string" || !/^\d+(\.\d{1,6})?$/.test(body.amount)) return c.json({ error: 'amount is a USDC string such as "0.05"' }, 400);
  try {
    return c.json(prepareStake(body.seller, toUnits(body.amount)));
  } catch (err) {
    return fail(c, err);
  }
});

/** Relays a signed stake. Body: the prepared message fields plus the wallet's signature. */
stakeRoutes.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!isAddress(b.from) || ![b.value, b.validAfter, b.validBefore].every((x) => typeof x === "string" && /^\d+$/.test(x)) || !/^0x[0-9a-fA-F]{64}$/.test(b.nonce ?? "") || typeof b.signature !== "string") {
    return c.json({ error: "body needs from, value, validAfter, validBefore, nonce and signature" }, 400);
  }
  try {
    return c.json(await relayStake(b));
  } catch (err) {
    return fail(c, err);
  }
});

stakeRoutes.post("/unstake/prepare", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isAddress(body.seller)) return c.json({ error: "seller must be a 0x EVM address" }, 400);
  try {
    return c.json(await prepareUnstake(body.seller));
  } catch (err) {
    return fail(c, err);
  }
});

stakeRoutes.post("/unstake", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!isAddress(b.seller) || typeof b.deadline !== "string" || typeof b.signature !== "string") return c.json({ error: "body needs seller, deadline and signature" }, 400);
  try {
    return c.json(await relayUnstake(b));
  } catch (err) {
    return fail(c, err);
  }
});

stakeRoutes.post("/withdraw", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!isAddress(b.seller)) return c.json({ error: "seller must be a 0x EVM address" }, 400);
  try {
    return c.json(await withdrawFor(b.seller));
  } catch (err) {
    return fail(c, err);
  }
});
