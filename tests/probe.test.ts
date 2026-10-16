import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { endpointBlockedReason, isPrivateAddress, probeListing } from "../src/registry/probe.js";
import { registry } from "../src/registry/routes.js";
import { getService, searchServices, upsertService } from "../src/registry/store.js";
import { accept, challenge402, OTHER, SELLER, service } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALLOW_PRIVATE_ENDPOINTS;
});

const respond = (res: Response | Error) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => (res instanceof Error ? Promise.reject(res) : res.clone()));

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "1.1.1.1", "2606:4700:4700::1111"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("endpointBlockedReason", () => {
  it("blocks private and loopback targets when private endpoints are not allowed", async () => {
    for (const e of ["http://127.0.0.1/x", "http://localhost:4021/x", "http://10.0.0.5/x", "http://[::1]/x", "http://169.254.169.254/latest/meta-data"]) {
      expect(await endpointBlockedReason(e, false), e).toMatch(/private/);
    }
  });
  it("lets public addresses through", async () => {
    expect(await endpointBlockedReason("https://8.8.8.8/fx", false)).toBeNull();
  });
  it("allows private targets when the registry itself is local", async () => {
    expect(await endpointBlockedReason("http://localhost:4021/x", true)).toBeNull();
  });
  it("always rejects non-http schemes and embedded credentials", async () => {
    expect(await endpointBlockedReason("file:///etc/passwd", true)).toMatch(/http/);
    expect(await endpointBlockedReason("ftp://x.example/a", true)).toMatch(/http/);
    expect(await endpointBlockedReason("https://user:pw@x.example/a", true)).toMatch(/credentials/);
    expect(await endpointBlockedReason("not a url", true)).toMatch(/valid URL/);
  });
});

describe("probeListing: compares the endpoint's real 402 with the listing", () => {
  const svc = service();

  it("verifies a matching 402", async () => {
    respond(challenge402());
    expect((await probeListing(svc)).verification).toBe("verified");
  });

  it("verifies a 402 that asks for less than listed", async () => {
    respond(challenge402(accept({ amount: "500" })));
    expect((await probeListing(svc)).verification).toBe("verified");
  });

  it("flags a 402 that asks ten times the listed price", async () => {
    respond(challenge402(accept({ amount: "10000" })));
    const r = await probeListing(svc);
    expect(r.verification).toBe("mismatch");
    expect(r.note).toMatch(/10x/);
  });

  it("flags a 402 that names a different payTo, network or token", async () => {
    for (const over of [{ payTo: OTHER }, { network: "eip155:1" }, { asset: OTHER }]) {
      respond(challenge402(accept(over)));
      expect((await probeListing(svc)).verification, JSON.stringify(over)).toBe("mismatch");
    }
  });

  it("flags an endpoint that gives its answer without asking for payment", async () => {
    respond(new Response("{}", { status: 200 }));
    expect(await probeListing(svc)).toMatchObject({ verification: "mismatch", note: expect.stringMatching(/without asking/) });
  });

  it("flags a 402 that is not a decodable x402 v2 challenge", async () => {
    respond(new Response("{}", { status: 402 }));
    expect((await probeListing(svc)).verification).toBe("mismatch");
  });

  it("does not judge an endpoint it could not get a 402 from", async () => {
    respond(new Response("bad input", { status: 400 }));
    expect((await probeListing(svc)).verification).toBe("unchecked");
    respond(new Response("", { status: 302, headers: { location: "http://elsewhere" } }));
    expect(await probeListing(svc)).toMatchObject({ verification: "unchecked", note: expect.stringMatching(/redirect/) });
    respond(new Error("connect ECONNREFUSED"));
    expect(await probeListing(svc)).toMatchObject({ verification: "unchecked", note: expect.stringMatching(/could not reach/) });
  });

  it("sends sample input built from the input schema and never a payment", async () => {
    const spy = respond(challenge402());
    await probeListing(service({ method: "POST", inputSchema: { type: "object", required: ["texts"], properties: { texts: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } } } } }));
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ texts: ["sample text", "sample text 2"] });
    expect(new Headers(init.headers).has("PAYMENT-SIGNATURE")).toBe(false);
    expect(init.redirect).toBe("manual");
  });
});

describe("registering a listing runs the probe", () => {
  const listing = (over: Record<string, unknown> = {}) => ({
    id: "probe-fx",
    name: "probe-fx",
    category: "data",
    endpoint: "https://seller.example/fx",
    price: "1000",
    payTo: SELLER,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    ...over,
  });
  const post = (body: unknown) => registry.request("/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  beforeEach(() => {
    db.exec("DELETE FROM services");
  });

  it("marks a matching seller verified", async () => {
    respond(challenge402());
    const res = await post(listing());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ verification: "verified" });
  });

  it("still lists a seller whose 402 lies, marked as a mismatch (the buyer's price check refuses it at payment time)", async () => {
    respond(challenge402(accept({ amount: "10000" })));
    const res = await post(listing());
    expect(res.status).toBe(201);
    expect(getService("probe-fx")).toMatchObject({ verification: "mismatch", verificationNote: expect.stringMatching(/contradicts/) });
  });

  it("lists an unreachable seller as unchecked", async () => {
    respond(new Error("offline"));
    expect((await post(listing())).status).toBe(201);
    expect(getService("probe-fx")!.verification).toBe("unchecked");
  });

  it("rejects private endpoints when this registry is public", async () => {
    process.env.ALLOW_PRIVATE_ENDPOINTS = "false";
    const spy = respond(challenge402());
    const res = await post(listing({ endpoint: "http://169.254.169.254/latest" }));
    expect(res.status).toBe(400);
    expect(getService("probe-fx")).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-probes when a listing is updated, so a changed price cannot keep an old 'verified'", async () => {
    respond(challenge402());
    await post(listing());
    respond(challenge402(accept({ amount: "1000" })));
    await post(listing({ price: "900" })); // 402 now asks 1000 > 900 listed
    expect(getService("probe-fx")!.verification).toBe("mismatch");
  });

  it("ranks mismatched listings last for the buyer", async () => {
    upsertService({ ...(listing({ id: "liar", name: "liar", price: "100" }) as any), owner: "external" });
    upsertService({ ...(listing({ id: "honest", name: "honest", price: "9000" }) as any), owner: "external" });
    db.prepare("UPDATE services SET verification = 'mismatch' WHERE id = 'liar'").run();
    expect(searchServices({ category: "data" }).map((s) => s.id)).toEqual(["honest", "liar"]);
  });
});
