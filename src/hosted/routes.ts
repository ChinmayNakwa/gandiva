import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import { currentUser } from "../auth/routes.js";
import { config } from "../config.js";
import { RegistryError, getService } from "../registry/store.js";
import { verifyService } from "../registry/probe.js";
import { HostedError, saveAgent, testAgent } from "./agents.js";

/** Sell-tab "LLM agent" template, mounted at /registry/mine/llm-agents. */
export const hostedRoutes = new Hono();

const MAX_BODY = 16 * 1024;
const tooLarge = (c: any) => c.json({ error: `request too large (max ${MAX_BODY} bytes)` }, 413);

function failure(c: any, err: unknown) {
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`).join("; "), issues: err.issues }, 400);
  if (err instanceof HostedError || err instanceof RegistryError) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: "body must be valid JSON" }, 400);
  throw err; // anything else is a real failure: app.onError logs it and answers 500
}

hostedRoutes.post("/", bodyLimit({ maxSize: MAX_BODY, onError: tooLarge }), async (c) => {
  const me = currentUser(c);
  if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
  try {
    const { service, hasKey } = await saveAgent(await c.req.json(), me);
    // Probe over loopback: the listed URL may be a tunnel that this machine cannot always reach.
    await verifyService(service, { endpoint: service.endpoint.replace(config.publicBaseUrl, `http://127.0.0.1:${config.port}`), timeoutMs: 20_000 });
    return c.json({ ...getService(service.id), hasKey }, 201);
  } catch (err) {
    return failure(c, err);
  }
});

hostedRoutes.post("/test", bodyLimit({ maxSize: MAX_BODY, onError: tooLarge }), async (c) => {
  const me = currentUser(c);
  if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
  try {
    return c.json(await testAgent(await c.req.json(), me));
  } catch (err) {
    return failure(c, err);
  }
});
